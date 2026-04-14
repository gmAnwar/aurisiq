import { getServiceClient } from "../_shared/supabase-client.ts";
import { TIER_LIMITS } from "../_shared/env.ts";
import type { BackgroundJob, ParsedOutput, MatchedPhase, DescalCategory, FunnelStage } from "./types.ts";
import { detectConversionDiscrepancy } from "./parser.ts";

const db = () => getServiceClient();

// ─── Read helpers ──────────────────────────────────────────

export async function getJob(jobId: string): Promise<BackgroundJob> {
  const { data, error } = await db()
    .from("background_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) throw new Error(`Job not found: ${jobId}`);
  return data as BackgroundJob;
}

export async function getScorecard(scorecardId: string, orgId: string) {
  const { data, error } = await db()
    .from("scorecards")
    .select("id, organization_id, name, version, vertical, phases, prompt_template, template_id, structure")
    .eq("id", scorecardId)
    .or(`organization_id.eq.${orgId},organization_id.is.null`)
    .single();
  if (error || !data) throw new Error(`Scorecard not found or not accessible: ${scorecardId}`);
  return data;
}

export async function getDescalCategories(orgId: string): Promise<DescalCategory[]> {
  const { data } = await db()
    .from("descalification_categories")
    .select("code, label")
    .eq("organization_id", orgId)
    .eq("active", true)
    .order("code");
  return (data || []) as DescalCategory[];
}

export async function getOrgStages(orgId: string): Promise<FunnelStage[]> {
  const { data } = await db()
    .from("funnel_stages")
    .select("id, name, scorecard_id")
    .eq("organization_id", orgId)
    .eq("active", true)
    .order("order_index");
  return (data || []) as FunnelStage[];
}

export async function getOrgVocabulary(orgId: string): Promise<{ term: string; definition: string }[]> {
  const { data } = await db()
    .from("organizations")
    .select("vocabulary")
    .eq("id", orgId)
    .single();
  if (data && Array.isArray(data.vocabulary)) return data.vocabulary;
  return [];
}

export async function getOrgPlan(orgId: string): Promise<string> {
  const { data } = await db()
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .single();
  return data?.plan || "starter";
}

export interface TrackerRow {
  code: string;
  label: string;
  icon: string;
  description: string;
  speaker: string;
}

export async function getOrgTrackers(orgId: string): Promise<TrackerRow[]> {
  const { data } = await db()
    .from("conversation_trackers")
    .select("code, label, icon, description, speaker")
    .or(`organization_id.eq.${orgId},organization_id.is.null`)
    .eq("active", true)
    .order("organization_id", { ascending: true, nullsFirst: true })
    .order("sort_order");
  return (data || []) as TrackerRow[];
}

export async function getStageChecklistItems(stageId: string): Promise<{ label: string; description: string | null }[]> {
  const { data } = await db()
    .from("stage_checklist_items")
    .select("label, description")
    .eq("funnel_stage_id", stageId)
    .eq("active", true)
    .order("sort_order");
  return (data || []) as { label: string; description: string | null }[];
}

// ─── Quota check ───────────────────────────────────────────

export async function checkQuota(orgId: string): Promise<boolean> {
  const plan = await getOrgPlan(orgId);
  const tierLimit = TIER_LIMITS[plan];
  const { data, error } = await db().rpc("check_and_increment_analysis_count", {
    org_id: orgId,
    tier_limit: tierLimit,
  });
  if (error) throw new Error(`Quota RPC error: ${error.message}`);
  return data === true;
}

export async function markQuotaConsumed(jobId: string) {
  await db().from("background_jobs").update({ quota_consumed: true }).eq("id", jobId);
}

// ─── Write: analyses + analysis_jobs ───────────────────────

export async function createAnalysis(job: BackgroundJob) {
  const p = job.payload;
  const { data, error } = await db()
    .from("analyses")
    .insert({
      organization_id: job.organization_id,
      user_id: job.user_id,
      scorecard_id: p.scorecard_id,
      funnel_stage_id: p.funnel_stage_id || null,
      fuente_lead_id: p.fuente_lead_id || null,
      prospect_identifier: p.prospect_identifier || null,
      avanzo_a_siguiente_etapa: p.avanzo_a_siguiente_etapa || "pending",
      categoria_descalificacion: [],
      status: "procesando",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create analysis: ${error?.message}`);
  return data.id as string;
}

export async function createAnalysisJob(
  analysisId: string,
  job: BackgroundJob,
) {
  const p = job.payload;
  const { error } = await db()
    .from("analysis_jobs")
    .insert({
      analysis_id: analysisId,
      organization_id: job.organization_id,
      user_id: job.user_id,
      status: "procesando",
      processing_started_at: new Date().toISOString(),
      transcription_text: p.transcription_text,
      transcription_original: p.transcription_original || null,
      transcription_edited: p.transcription_edited || null,
      edit_percentage: p.edit_percentage || 0,
      has_audio: p.has_audio || false,
      pause_count: p.pause_count || 0,
      total_paused_seconds: p.total_paused_seconds || 0,
    });
  if (error) throw new Error(`Failed to create analysis_job: ${error.message}`);
}

// ─── Write: analysis results ───────────────────────────────

export async function writeAnalysisResults(
  analysisId: string,
  parsed: ParsedOutput,
  job: BackgroundJob,
  descalCats: DescalCategory[],
  orgStages: FunnelStage[],
) {
  const validCodes = new Set(descalCats.map(c => c.code));
  const validDescal = parsed.descalificacion.filter(code => validCodes.has(code));

  const discrepancy = detectConversionDiscrepancy(
    parsed.lead_status,
    job.payload.avanzo_a_siguiente_etapa || "pending",
  );

  // Find related prospect
  let relatedId: string | null = null;
  if (parsed.prospect_name && parsed.prospect_name !== "No identificado") {
    const { data } = await db()
      .from("analyses")
      .select("id")
      .eq("organization_id", job.organization_id)
      .eq("status", "completado")
      .neq("id", analysisId)
      .ilike("prospect_name", parsed.prospect_name.trim())
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) relatedId = data[0].id;
  }

  // Resolve detected stage
  let detectedStageId: string | null = null;
  if (parsed.detected_stage_name && orgStages.length > 0) {
    const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const target = norm(parsed.detected_stage_name);
    const match = orgStages.find(s => s.name && norm(s.name) === target);
    if (match) detectedStageId = match.id;
  }

  // Validate score
  if (parsed.score_general === null) {
    throw new Error("Claude returned malformed output: score_general is null");
  }

  const updatePayload: Record<string, unknown> = {
    score_general: Math.min(parsed.score_general, 100),
    clasificacion: parsed.clasificacion,
    momento_critico: parsed.momento_critico,
    patron_error: parsed.patron_error,
    objecion_principal: parsed.objecion_principal,
    siguiente_accion: parsed.siguiente_accion,
    conversion_discrepancy: discrepancy,
    categoria_descalificacion: validDescal.length > 0 ? validDescal : [],
    prospect_name: parsed.prospect_name,
    prospect_zone: parsed.prospect_zone,
    property_type: parsed.property_type,
    business_type: parsed.business_type,
    equipment_type: parsed.equipment_type,
    sale_reason: parsed.sale_reason,
    prospect_phone: job.payload.prospect_phone || parsed.prospect_phone,
    checklist_results: parsed.checklist_results,
    notes: job.payload.call_notes || null,
    related_analysis_id: relatedId,
    highlights: parsed.highlights.length > 0 ? parsed.highlights : [],
    status: "completado",
  };

  // Only override funnel_stage_id if user didn't send one
  if (detectedStageId && !job.payload.funnel_stage_id) {
    updatePayload.funnel_stage_id = detectedStageId;
  }

  const { error } = await db()
    .from("analyses")
    .update(updatePayload)
    .eq("id", analysisId);
  if (error) throw new Error(`Failed to update analysis: ${error.message}`);
}

// ─── Write: analysis_phases ────────────────────────────────

export async function writeAnalysisPhases(
  analysisId: string,
  phases: MatchedPhase[],
  orgId: string,
  userId: string,
) {
  if (phases.length === 0) return;
  const rows = phases.map(p => ({
    analysis_id: analysisId,
    organization_id: orgId,
    user_id: userId,
    phase_id: p.phase_id,
    phase_name: p.phase_name,
    score: Math.min(p.score, p.score_max),
    score_max: p.score_max,
  }));
  const { error } = await db().from("analysis_phases").insert(rows);
  if (error) throw new Error(`Failed to insert phases: ${error.message}`);
}

// ─── Update user stats ─────────────────────────────────────

export async function updateUserStats(userId: string, orgId: string) {
  // 1. Current focus phase (worst ratio of last 5 analyses)
  const { data: phasesData } = await db()
    .from("analysis_phases")
    .select("analysis_id, phase_id, phase_name, score, score_max")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (phasesData && phasesData.length > 0) {
    const uniqueIds = [...new Set(phasesData.map(a => a.analysis_id))].slice(0, 5);
    const recent = phasesData.filter(a => uniqueIds.includes(a.analysis_id));

    const phaseAvgs: Record<string, { total: number; max: number; name: string }> = {};
    for (const p of recent) {
      const key = p.phase_id || p.phase_name;
      if (!phaseAvgs[key]) phaseAvgs[key] = { total: 0, max: 0, name: p.phase_name };
      phaseAvgs[key].total += p.score;
      phaseAvgs[key].max += p.score_max;
    }

    let worstPhase: string | null = null;
    let worstRatio = 1;
    for (const avg of Object.values(phaseAvgs)) {
      const ratio = avg.max > 0 ? avg.total / avg.max : 1;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstPhase = avg.name;
      }
    }

    if (worstPhase) {
      await db().from("users").update({ current_focus_phase: worstPhase }).eq("id", userId);
    }
  }

  // 2. Current streak (business days)
  const { data: userData } = await db()
    .from("users")
    .select("last_analysis_date, current_streak, longest_streak")
    .eq("id", userId)
    .single();
  if (!userData) return;

  const { data: funnelData } = await db()
    .from("funnel_config")
    .select("working_days")
    .eq("organization_id", orgId)
    .limit(1)
    .single();
  const workingDays: number[] = funnelData?.working_days || [1, 2, 3, 4, 5];

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  if (userData.last_analysis_date === todayStr) return;

  const checkDate = new Date(today);
  checkDate.setDate(checkDate.getDate() - 1);
  while (!workingDays.includes(checkDate.getDay() === 0 ? 7 : checkDate.getDay())) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  const lastWorkingDay = checkDate.toISOString().split("T")[0];

  const newStreak = userData.last_analysis_date === lastWorkingDay
    ? (userData.current_streak || 0) + 1
    : 1;
  const newLongest = Math.max(newStreak, userData.longest_streak || 0);

  await db().from("users").update({
    last_analysis_date: todayStr,
    current_streak: newStreak,
    longest_streak: newLongest,
  }).eq("id", userId);
}

// ─── Update highlights (second Claude call) ────────────────

export async function updateAnalysisHighlights(
  analysisId: string,
  highlights: { type: string; snippet: string; description: string }[],
) {
  const { error } = await db()
    .from("analyses")
    .update({ highlights })
    .eq("id", analysisId);
  if (error) console.warn(`[highlights] Failed to update highlights: ${error.message}`);
}

// ─── Complete analysis_jobs ────────────────────────────────

export async function completeAnalysisJob(analysisId: string) {
  await db().from("analysis_jobs").update({
    status: "completado",
    completed_at: new Date().toISOString(),
  }).eq("analysis_id", analysisId);
}

// ─── Background job status updates ─────────────────────────

export async function writeJobDiagnostic(jobId: string, message: string) {
  try {
    await db().from("background_jobs").update({ error_message: message }).eq("id", jobId);
  } catch { /* non-blocking */ }
}

export async function completeJob(jobId: string, analysisId: string) {
  await db().from("background_jobs").update({
    status: "completed",
    result: { analysis_id: analysisId },
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);
}

export async function failJob(jobId: string, errorMessage: string, retryCount: number, maxRetries: number) {
  const isRetryable = retryCount < maxRetries;
  const backoffSeconds = [10, 60, 300][Math.min(retryCount, 2)];

  await db().from("background_jobs").update({
    status: isRetryable ? "pending" : "error",
    error_message: errorMessage,
    retry_count: retryCount + 1,
    next_retry_at: isRetryable ? new Date(Date.now() + backoffSeconds * 1000).toISOString() : null,
    completed_at: isRetryable ? null : new Date().toISOString(),
  }).eq("id", jobId);
}

export async function failAnalysis(analysisId: string, errorMessage: string) {
  await db().from("analyses").update({ status: "error" }).eq("id", analysisId);
  await db().from("analysis_jobs").update({
    status: "error",
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }).eq("analysis_id", analysisId);
}
