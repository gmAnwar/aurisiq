// v22 — extract lead_quality + lead_outcome from ESTADO DEL LEAD block
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getJob,
  getScorecard,
  getDescalCategories,
  getOrgStages,
  getOrgVocabulary,
  getOrgTrackers,
  getStageChecklistItems,
  checkQuota,
  createAnalysis,
  createAnalysisJob,
  writeAnalysisResults,
  writeAnalysisPhases,
  updateUserStats,
  updateAnalysisHighlights,
  completeAnalysisJob,
  completeJob,
  failJob,
  failAnalysis,
  markQuotaConsumed,
  writeJobDiagnostic,
} from "./db.ts";
import { buildFullPrompt, callClaude, callClaudeForHighlights } from "./claude.ts";
import { parseClaudeOutput, matchPhaseIds } from "./parser.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await req.json();
  const jobId = body.job_id;
  if (!jobId) return jsonResponse({ error: "Missing job_id" }, 400);

  // Respond immediately, process in background
  EdgeRuntime.waitUntil(processJobAsync(jobId));
  return jsonResponse({ accepted: true, job_id: jobId }, 202);
});

async function processJobAsync(jobId: string) {
  let analysisId: string | undefined;
  let lastRawOutput: string | undefined;

  try {
    console.log(`[analyze] Starting job ${jobId}`);

    // 1. Read job
    const job = await getJob(jobId);
    if (job.status !== "processing") {
      console.error(`[analyze] Job ${jobId} status is ${job.status}, expected processing`);
      return;
    }

    const payload = job.payload;

    // 2. Check quota (skip if already consumed on a previous attempt)
    if (!job.quota_consumed) {
      const quotaOk = await checkQuota(job.organization_id);
      if (!quotaOk) {
        await failJob(jobId, "Monthly analysis quota exceeded", job.retry_count, 0);
        return;
      }
      await markQuotaConsumed(jobId);
    }

    // 3. Read scorecard (validated against org)
    const scorecard = await getScorecard(payload.scorecard_id, job.organization_id);

    // 4. Create analyses + analysis_jobs rows
    analysisId = await createAnalysis(job);
    await createAnalysisJob(analysisId, job);
    console.log(`[analyze] Created analysis ${analysisId} for job ${jobId}`);

    // 5. Fetch context data in parallel
    const [descalCats, orgStages, vocabulary, checklistItems] = await Promise.all([
      getDescalCategories(job.organization_id),
      getOrgStages(job.organization_id),
      getOrgVocabulary(job.organization_id),
      payload.funnel_stage_id ? getStageChecklistItems(payload.funnel_stage_id) : Promise.resolve([]),
    ]);

    // 6. Build prompt
    const { systemPrompt, extractionPatterns } = buildFullPrompt(
      scorecard,
      vocabulary,
      descalCats,
      orgStages,
      checklistItems,
    );

    // 7. Call Claude
    const transcription = payload.transcription_edited || payload.transcription_original || payload.transcription_text;
    console.log(`[analyze] Calling Claude for job ${jobId}, transcription length: ${transcription.length}`);
    const rawOutput = await callClaude(systemPrompt, transcription);
    lastRawOutput = rawOutput;
    console.log(`[analyze] Claude response length: ${rawOutput.length}`);

    // 8. Parse
    const parsed = parseClaudeOutput(rawOutput, extractionPatterns || null);
    const phasesWithIds = matchPhaseIds(parsed.phases, scorecard.phases || []);
    console.log(`[analyze v22] Parsed ${parsed.phases.length} phases, matched ${phasesWithIds.length}, phase_ids: ${JSON.stringify(phasesWithIds.map(p => p.phase_id))}`);

    // Diagnostic: low score with no descalification — write to background_jobs.error_message for visibility
    if (parsed.score_general !== null && parsed.score_general < 50 && parsed.descalificacion.length === 0) {
      const rawTail = (lastRawOutput || "").slice(-2500).replace(/\s+/g, " ");
      const diagMsg = `LOW_SCORE_NO_DESCAL score=${parsed.score_general} descalCats_available=${descalCats.length} raw_descal_section=${(lastRawOutput || "").includes("DESCALIFICACION") ? "FOUND_IN_OUTPUT" : "NOT_IN_OUTPUT"} | RAW_TAIL: ${rawTail}`;
      console.warn(`[analyze] ${diagMsg} job=${jobId}`);
      await writeJobDiagnostic(jobId, diagMsg);
    }

    // 9. Write results
    await writeAnalysisResults(analysisId, parsed, job, descalCats, orgStages);
    await writeAnalysisPhases(analysisId, phasesWithIds, job.organization_id, job.user_id);
    await updateUserStats(job.user_id, job.organization_id);
    await completeAnalysisJob(analysisId);

    // 10. Second Claude call for tracker-based highlights (non-blocking on failure)
    try {
      console.log(`[analyze] Starting highlights call for job ${jobId}`);
      const trackers = await getOrgTrackers(job.organization_id);
      const highlights = await callClaudeForHighlights(transcription, trackers, {
        score_general: parsed.score_general ?? 0,
        clasificacion: parsed.clasificacion,
        patron_error: parsed.patron_error,
        objecion_principal: parsed.objecion_principal,
      });
      if (highlights.length > 0) {
        await updateAnalysisHighlights(analysisId, highlights);
        console.log(`[analyze] Wrote ${highlights.length} highlights for job ${jobId}`);
      } else {
        console.warn(`[analyze] No highlights returned for job ${jobId}`);
      }
    } catch (hlErr) {
      console.warn(`[analyze] Highlights failed (non-fatal): ${hlErr instanceof Error ? hlErr.message : "unknown"}`);
    }

    // 11. Mark job complete
    await completeJob(jobId, analysisId);
    console.log(`[analyze] Completed job ${jobId} → analysis ${analysisId}`);
  } catch (err) {
    let msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("score_general is null") && lastRawOutput) {
      msg = `${msg} | RAW_HEAD: ${lastRawOutput.slice(0, 800).replace(/\s+/g, " ")}`;
    }
    console.error(`[analyze] Error processing job ${jobId}: ${msg}`);

    if (analysisId) {
      try { await failAnalysis(analysisId, msg); } catch { /* best effort */ }
    }

    try {
      const job = await getJob(jobId);
      await failJob(jobId, msg, job.retry_count, job.max_retries);
    } catch { /* can't even read job */ }
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
