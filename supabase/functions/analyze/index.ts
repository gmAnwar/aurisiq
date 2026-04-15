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
  markQuotaConsumed,
  writeJobDiagnostic,
} from "./db.ts";
import { buildFullPrompt, callClaude, callClaudeForHighlights } from "./claude.ts";
import { parseClaudeOutput, matchPhaseIds } from "./parser.ts";
import { ASSEMBLYAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../_shared/env.ts";

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
    let transcription: string;
    if (payload.audio_storage_path && !payload.transcription_text) {
      console.log(`[analyze v23] Transcribing audio from Storage: ${payload.audio_storage_path}`);
      transcription = await transcribeFromStorage(payload.audio_storage_path);
      console.log(`[analyze v23] Transcription complete: ${transcription.length} chars`);
    } else {
      transcription = payload.transcription_edited || payload.transcription_original || payload.transcription_text;
    }
    console.log(`[analyze v23] Calling Claude for job ${jobId}, transcription length: ${transcription.length}`);
    const rawOutput = await callClaude(systemPrompt, transcription);
    lastRawOutput = rawOutput;
    console.log(`[analyze] Claude response length: ${rawOutput.length}`);

    // 8. Parse
    const parsed = parseClaudeOutput(rawOutput, extractionPatterns || null);
    const phasesWithIds = matchPhaseIds(parsed.phases, scorecard.phases || []);
    console.log(`[analyze v23] Parsed ${parsed.phases.length} phases, matched ${phasesWithIds.length}, phase_ids: ${JSON.stringify(phasesWithIds.map(p => p.phase_id))}`);

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

// ─── Transcribe audio from Supabase Storage via AssemblyAI ──

async function transcribeFromStorage(storagePath: string): Promise<string> {
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
    const pollData = await pollRes.json();
    if (pollData.status === "completed") {
      if (!pollData.text || pollData.text.trim().length === 0) {
        throw new Error("No se detectó audio hablado en la grabación");
      }
      return pollData.text;
    }
    if (pollData.status === "error") {
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
