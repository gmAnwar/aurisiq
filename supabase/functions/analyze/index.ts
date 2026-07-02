// v23 — handle audio_storage_path: download from Storage + transcribe via AssemblyAI
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
  rejectJob,
  rejectAnalysis,
  markQuotaConsumed,
  writeJobDiagnostic,
} from "./db.ts";
import { buildFullPrompt, callClaude, callClaudeForHighlights } from "./claude.ts";
import { parseClaudeOutput, matchPhaseIds } from "./parser.ts";
import { ASSEMBLYAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../_shared/env.ts";
import { RejectedAnalysisError } from "../_shared/errors.ts";
import { mapRejectionToHumanText } from "../_shared/rejection-reasons.ts";
import { alertSlack, type AlertContext } from "../_shared/alert.ts";

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

    // 7. Resolve transcription — either from payload or by transcribing audio from Storage
    // F21: alertCtx propagado a callClaude + callClaudeForHighlights +
    // transcribeFromStorage para alerting on non-transient 4xx/5xx.
    const alertCtx: AlertContext = {
      organization_id: job.organization_id,
      user_id: job.user_id,
    };

    let transcription: string;
    if (payload.audio_storage_path && !payload.transcription_text) {
      console.log(`[analyze v23] Transcribing audio from Storage: ${payload.audio_storage_path}`);
      transcription = await transcribeFromStorage(payload.audio_storage_path, alertCtx);
      console.log(`[analyze v23] Transcription complete: ${transcription.length} chars`);
    } else {
      transcription = payload.transcription_edited || payload.transcription_original || payload.transcription_text;
    }
    console.log(`[analyze v23] Calling Claude for job ${jobId}, transcription length: ${transcription.length}`);
    const claudeResponse = await callClaude(systemPrompt, transcription, alertCtx);

    // 7b. Branch: LLM signaled rejection via tool_use (early return before parse + highlights)
    if (claudeResponse.type === "rejected") {
      const humanText = mapRejectionToHumanText(
        claudeResponse.rejection!.reason,
        claudeResponse.rejection!.details_es_mx,
      );
      console.log(`[analyze] Tool-signaled rejection job=${jobId} reason=${claudeResponse.rejection!.reason}`);
      throw new RejectedAnalysisError(humanText);
    }

    // 7c. Branch: analyzed — prose path
    const rawOutput = claudeResponse.proseText!;
    lastRawOutput = rawOutput;
    console.log(`[analyze] Claude response length: ${rawOutput.length}`);

    // 8. Parse
    const parsed = parseClaudeOutput(rawOutput, extractionPatterns || null);

    // 8b. Parser drift detection — analyzed branch should always produce SCORE GENERAL.
    // If null reaches here, the LLM output was malformed BUT it didn't call the rejection
    // tool — surface as technical error (status='error'), NOT silent rejection.
    if (parsed.score_general === null) {
      console.error("[analyze] Analyzed branch but score_general null", {
        jobId,
        organizationId: job.organization_id,
        scorecardId: job.payload?.scorecard_id,
        rawTextPreview: rawOutput.slice(0, 300),
      });
      throw new Error(
        "Parser drift: score_general null in analyzed branch (LLM should have called tool or output valid SCORE GENERAL)",
      );
    }

    const phasesWithIds = matchPhaseIds(parsed.phases, scorecard.phases || []);
    console.log(`[analyze v23] Parsed ${parsed.phases.length} phases, matched ${phasesWithIds.length}, phase_ids: ${JSON.stringify(phasesWithIds.map(p => p.phase_id))}`);

    // F42: detector de extracción parcial. El análisis SE COMPLETA igual (data
    // parcial > error para la captadora), pero deja de ser silencioso.
    // Logging condicional: el raw output completo va a logs SOLO en este caso —
    // cero PII en logs de análisis sanos.
    const expectedPhases = (scorecard.phases || []).length;
    const promptHasEstado = systemPrompt.includes("ESTADO DEL LEAD");
    const missingLead = promptHasEstado && (parsed.lead_quality === null || parsed.lead_outcome === null);
    if (phasesWithIds.length < expectedPhases || missingLead) {
      const detail = `phases=${phasesWithIds.length}/${expectedPhases} lead_quality=${parsed.lead_quality} lead_outcome=${parsed.lead_outcome} scorecard=${job.payload?.scorecard_id}`;
      console.error(`[F42] partial_extraction job=${jobId} ${detail} RAW_OUTPUT: ${rawOutput}`);
      try {
        await alertSlack({
          service: "parser",
          error_code: "partial_extraction",
          error_message: detail,
          runtime: "edge_function",
          organization_id: job.organization_id,
          user_id: job.user_id,
        });
      } catch { /* alerting nunca bloquea el análisis */ }
    }

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
      const highlights = await callClaudeForHighlights(
        transcription,
        trackers,
        {
          score_general: parsed.score_general ?? 0,
          clasificacion: parsed.clasificacion,
          patron_error: parsed.patron_error,
          objecion_principal: parsed.objecion_principal,
        },
        alertCtx,
      );
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
    if (err instanceof RejectedAnalysisError) {
      console.error(`[analyze] Rejected job ${jobId}: ${err.reason}`);
      if (analysisId) {
        try { await rejectAnalysis(analysisId, err.reason); } catch { /* best effort */ }
      }
      try { await rejectJob(jobId, err.reason); } catch { /* best effort */ }
      return;
    }

    const msg = err instanceof Error ? err.message : "Unknown error";
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

// ─── Transcribe audio from Supabase Storage via AssemblyAI ──

async function transcribeFromStorage(
  storagePath: string,
  alertCtx: AlertContext | null = null,
): Promise<string> {
  // 1. Download audio from Supabase Storage using service role
  const storageUrl = `${SUPABASE_URL}/storage/v1/object/recordings/${storagePath}`;
  const downloadRes = await fetch(storageUrl, {
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!downloadRes.ok) {
    throw new Error(`Failed to download audio from Storage: ${downloadRes.status}`);
  }
  const audioBytes = new Uint8Array(await downloadRes.arrayBuffer());
  console.log(`[transcribe] Downloaded ${audioBytes.length} bytes from Storage`);

  if (!ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY not configured");
  }

  // 2. Upload to AssemblyAI
  const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      "content-type": "application/octet-stream",
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) {
    // F21: alert on 4xx/5xx EXCEPT 429.
    if (alertCtx && uploadRes.status !== 429) {
      await alertSlack({
        service: "assemblyai",
        error_code: String(uploadRes.status),
        error_message: `upload failed: ${uploadRes.status}`,
        runtime: "edge_function",
        organization_id: alertCtx.organization_id,
        user_id: alertCtx.user_id,
      });
    }
    throw new Error(`AssemblyAI upload failed: ${uploadRes.status}`);
  }
  const { upload_url } = await uploadRes.json();

  // 3. Start transcription
  const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio_url: upload_url, language_code: "es", speech_models: ["universal-3-pro"] }),
  });
  if (!transcriptRes.ok) {
    if (alertCtx && transcriptRes.status !== 429) {
      await alertSlack({
        service: "assemblyai",
        error_code: String(transcriptRes.status),
        error_message: `transcript request failed: ${transcriptRes.status}`,
        runtime: "edge_function",
        organization_id: alertCtx.organization_id,
        user_id: alertCtx.user_id,
      });
    }
    throw new Error(`AssemblyAI transcript request failed: ${transcriptRes.status}`);
  }
  const { id: transcriptId } = await transcriptRes.json();

  // 4. Poll for completion (max 180 seconds for long recordings)
  const maxPolls = 60;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: ASSEMBLYAI_API_KEY },
    });
    if (!pollRes.ok) {
      // HTTP 4xx/5xx en polling endpoint — diferente de pollData.status='error'.
      if (alertCtx && pollRes.status !== 429) {
        await alertSlack({
          service: "assemblyai",
          error_code: String(pollRes.status),
          error_message: `polling endpoint failed: ${pollRes.status}`,
          runtime: "edge_function",
          organization_id: alertCtx.organization_id,
          user_id: alertCtx.user_id,
        });
      }
      throw new Error(`AssemblyAI polling failed: ${pollRes.status}`);
    }
    const pollData = await pollRes.json();
    if (pollData.status === "completed") {
      if (!pollData.text || pollData.text.trim().length === 0) {
        throw new Error("No se detectó audio hablado en la grabación");
      }
      return pollData.text;
    }
    if (pollData.status === "error") {
      // NO alert — pollData.status='error' es per-audio failure (audio corrupt
      // o no procesable), no infra. Plan G captura esto downstream como
      // analyses.status='rechazado'.
      throw new Error(`AssemblyAI error: ${pollData.error || "unknown"}`);
    }
  }
  throw new Error("AssemblyAI transcription timed out (180s)");
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
