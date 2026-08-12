// v26 — F48b: score_desempeno separado de la calidad del prospecto. Bloque
// EVALUACION DE DESCARTE condicional al catálogo lead_dependent de
// scorecards.phases + computeScoreDesempeno (puro) + trigger
// descarte_block_missing cuando el descarte no trae con qué calcular.
// (v25: F48a — gate de fragmento pre-LLM (<1500 chars → prompt bifurcado,
// score_general/clasificacion NULL POR DISEÑO, unscorable_reason='fragmento',
// cero analysis_phases, sin highlights; precedencia rechazado > fragmento.)
// (v24: EXTRACTION_WRITABLE_COLUMNS + vehicle_interest/financing_type + alerta
// extraction_config_invalid deduplicada. v23: audio_storage_path + AssemblyAI.)
// Regla: EDGE_VERSION se bumpea SIEMPRE que cambie comportamiento del parser —
// existe para correlación forense en analysis_parser_debug.edge_version.
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
  writeParserDebug,
} from "./db.ts";
import { buildFullPrompt, callClaude, callClaudeForHighlights } from "./claude.ts";
import { isFragmentTranscript, buildFragmentPrompt, parseFragmentOutput } from "./fragment.ts";
import { parseClaudeOutput, matchPhaseIds, deriveScoreFromPhases } from "./parser.ts";
import { computeScoreDesempeno } from "./score-desempeno.ts";
import type { MatchedPhase } from "./types.ts";
import { buildParserDebug, filterExpectedMisses, normalizeDescal } from "./parser-debug.ts";
import { ASSEMBLYAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../_shared/env.ts";
import { RejectedAnalysisError, ApiStatusError, AudioContentError, classifyError } from "../_shared/errors.ts";
import { mapRejectionToHumanText } from "../_shared/rejection-reasons.ts";
import { alertSlack, type AlertContext } from "../_shared/alert.ts";

// F46: marcador interno de versión del código (fuente: header del archivo). NO
// es el contador de deployment de Supabase (que va por su cuenta). Se persiste
// en analysis_parser_debug.edge_version para correlacionar el diagnóstico.
const EDGE_VERSION = "v26";

// Config inválida de extraction_patterns ya alertada por este isolate —
// dedupe en memoria: primera aparición del scorecard → alerta F21; después
// solo console.warn. Es un error ESTÁTICO de configuración (no cambia entre
// análisis): alertar por análisis sería flood determinista. El reciclado de
// isolates produce re-avisos ocasionales — balance deseado, cero estado en DB.
const alertedInvalidConfigScorecards = new Set<string>();

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
        await failJob(jobId, "Monthly analysis quota exceeded", job.retry_count, 0, "quota");
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

    // 6. Resolve transcription — either from payload or by transcribing audio from Storage
    // F48a: movido ANTES del build del prompt — la longitud del transcript
    // decide qué prompt se usa (buildFullPrompt no depende del transcript).
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

    // 7. F48a: gate de fragmento pre-LLM — cubre ambos inputs (texto y audio;
    // el frontend solo conoce la longitud en el path texto). La cuota ya se
    // consumió en el paso 2 (regla vigente). Un fragmento va por prompt
    // bifurcado: feedback breve + estado del lead + extracción, SIN score ni
    // fases. El rejection tool viaja igual en ambos paths (callClaude lo manda
    // siempre): rechazado > fragmento.
    const isFragment = isFragmentTranscript(transcription);
    const { systemPrompt, extractionPatterns } = isFragment
      ? buildFragmentPrompt(scorecard, descalCats)
      : buildFullPrompt(scorecard, vocabulary, descalCats, orgStages, checklistItems);
    console.log(`[analyze v25] Calling Claude for job ${jobId}, transcription length: ${transcription.length}, fragment: ${isFragment}`);
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

    // 8. Parse — F48a: los fragmentos pasan por parseFragmentOutput (mismo
    // parser con normalización de separador inicial; ver fragment.ts).
    const parsed = isFragment
      ? parseFragmentOutput(rawOutput, extractionPatterns || null)
      : parseClaudeOutput(rawOutput, extractionPatterns || null);

    // 8b. Parser drift detection — SOLO rama scored: ahí el LLM debe producir
    // SCORE GENERAL. Si llega null sin haber llamado el rejection tool →
    // error técnico (status='error'), NOT silent rejection.
    // F48a: en fragmento el score null es POR DISEÑO — el guard no aplica
    // (y el payload es null-safe: guard y payload cambian JUNTOS).
    if (!isFragment && parsed.score_general === null) {
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

    let phasesWithIds: MatchedPhase[] = [];
    if (isFragment) {
      // F48a: NULL honesto forzado — si el modelo desobedece y emite score o
      // fases en un fragmento, se descartan. Un fragmento NUNCA se puntúa y
      // NUNCA escribe filas en analysis_phases (los 6 fragmentos históricos
      // metieron 26 filas de fases con avg 2.96 que contaminan la métrica de
      // fase más débil que alimenta digest semanal y coaching).
      if (parsed.score_general !== null || parsed.phases.length > 0) {
        console.warn(`[F48a] fragmento con score/fases emitidos por el modelo — descartados (job=${jobId}, score=${parsed.score_general}, fases=${parsed.phases.length})`);
      }
      parsed.score_general = null;
      parsed.clasificacion = null;
      parsed.phases = [];
    } else {
      phasesWithIds = matchPhaseIds(parsed.phases, scorecard.phases || []);
      console.log(`[analyze v23] Parsed ${parsed.phases.length} phases, matched ${phasesWithIds.length}, phase_ids: ${JSON.stringify(phasesWithIds.map(p => p.phase_id))}`);

      // F44: score_general = suma de fases clampeadas cuando la extracción está
      // completa; parcial → conserva el del LLM. Log de drift siempre.
      const scoreDerivation = deriveScoreFromPhases(
        parsed.score_general,
        parsed.clasificacion,
        phasesWithIds,
        (scorecard.phases || []).length,
      );
      console.log(`[F44] score_drift ${JSON.stringify({
        analysis_id: analysisId,
        llm_score: parsed.score_general,
        phase_sum: scoreDerivation.phaseSum,
        delta: scoreDerivation.phaseSum === null || parsed.score_general === null ? null : parsed.score_general - scoreDerivation.phaseSum,
        overridden: scoreDerivation.overridden,
      })}`);
      parsed.score_general = scoreDerivation.score;
      parsed.clasificacion = scoreDerivation.clasificacion;
    }

    // F48b: desempeño de la captadora. Corre ANTES de buildParserDebug porque
    // su gate alimenta el trigger descarte_block_missing (y con él la captura
    // del raw, que es lo único que permite reconstruir qué emitió el modelo).
    const desempeno = computeScoreDesempeno({
      leadQuality: parsed.lead_quality,
      scoreGeneral: parsed.score_general,
      parsedPhases: phasesWithIds,
      phasesCatalog: scorecard.phases,
      descarte: parsed.descarte,
      unscorableReason: isFragment ? "fragmento" : null,
    });
    console.log(`[F48b] desempeno ${JSON.stringify({
      analysis_id: analysisId,
      lead_quality: parsed.lead_quality,
      score_general: parsed.score_general,
      score_desempeno: desempeno.score,
      descarte_presente: parsed.descarte !== null,
      block_missing: desempeno.descarteBlockMissing,
    })}`);

    // Persistencia: columns declaradas que el pipeline no puede escribir
    // (fuera de EXTRACTION_WRITABLE_COLUMNS) — warn siempre, alerta deduplicada.
    if (parsed.unsupported_extraction_columns.length > 0) {
      const scorecardId = String(payload.scorecard_id ?? "unknown");
      console.warn(`[parser] extraction_config_invalid scorecard=${scorecardId} columns=${parsed.unsupported_extraction_columns.join(",")}`);
      if (!alertedInvalidConfigScorecards.has(scorecardId)) {
        alertedInvalidConfigScorecards.add(scorecardId);
        try {
          await alertSlack({
            service: "parser",
            error_code: "extraction_config_invalid",
            error_message: `columns no persistibles en extraction_patterns: ${parsed.unsupported_extraction_columns.join(",")} scorecard=${scorecardId}`,
            runtime: "edge_function",
            organization_id: job.organization_id,
            user_id: job.user_id,
          });
        } catch { /* alerting nunca bloquea el análisis */ }
      }
    }

    // F42: detector de extracción parcial. El análisis SE COMPLETA igual (data
    // parcial > error para la captadora), pero deja de ser silencioso.
    // Logging condicional: el raw output completo va a logs SOLO en este caso —
    // cero PII en logs de análisis sanos.
    // F48a: el prompt de fragmento no pide fases — 0 esperadas para que el
    // detector F42 no dispare phases_mismatch falso. missing_lead sigue vivo
    // (el fragmento SÍ pide ESTADO DEL LEAD — monitoreo real, no falso positivo).
    const expectedPhases = isFragment ? 0 : (scorecard.phases || []).length;
    const promptHasEstado = systemPrompt.includes("ESTADO DEL LEAD");
    // F47: solo cuentan como pérdida los labels de extracción que el prompt
    // realmente pidió (espejo del gate promptHasEstado).
    const extractionMisses = filterExpectedMisses(parsed.extraction_label_misses, systemPrompt);
    // F47-B: si el prompt ni pidió DESCALIFICACION (org sin catálogo), el null
    // del parser es [] legítimo, no una pérdida.
    parsed.descalificacion = normalizeDescal(parsed.descalificacion, systemPrompt.includes("DESCALIFICACION"));
    // F46: buildParserDebug es la fuente única de "¿extracción parcial?" — null =
    // camino feliz (cero escritura). Non-null = disparó al menos una causa.
    const parserDebug = buildParserDebug({
      rawOutput,
      rawEstadoBlock: parsed.raw_estado_block,
      leadQuality: parsed.lead_quality,
      leadOutcome: parsed.lead_outcome,
      promptHasEstado,
      phasesFoundIds: phasesWithIds.map((p) => p.phase_id),
      phasesExpected: expectedPhases,
      edgeVersion: EDGE_VERSION,
      extractionMisses,
      descalParseFailed: parsed.descalificacion === null,
      descarteBlockMissing: desempeno.descarteBlockMissing,
    });
    if (parserDebug) {
      const detail = `triggers=${parserDebug.triggers.join("+")} phases=${parserDebug.phases_found}/${parserDebug.phases_expected} lead_quality=${parsed.lead_quality} lead_outcome=${parsed.lead_outcome} missing=${parserDebug.missing_fields.join(",")} scorecard=${job.payload?.scorecard_id}`;
      console.error(`[F42] partial_extraction job=${jobId} ${detail} RAW_OUTPUT: ${rawOutput}`);
      // F46: persistir el diagnóstico (incluye raw crudo con PII) en tabla aparte.
      // try/catch propio: un fallo de diagnóstico JAMÁS degrada un análisis completado.
      try {
        await writeParserDebug(analysisId, parserDebug);
      } catch (dbgErr) {
        console.error(`[F46] parser_debug write failed job=${jobId}: ${dbgErr instanceof Error ? dbgErr.message : "unknown"}`);
      }
      try {
        await alertSlack({
          service: "parser",
          error_code: "partial_extraction",
          error_message: detail,
          runtime: "edge_function",
          organization_id: job.organization_id,
          user_id: job.user_id,
          // F46: solo el id — el raw_estado con PII se diagnostica contra la DB, NO a Slack.
          analysis_id: analysisId,
        });
      } catch { /* alerting nunca bloquea el análisis */ }
    }

    // Diagnostic: low score with no descalification — write to background_jobs.error_message for visibility
    // F47: con descalificacion null (ilegible) este diagnóstico no aplica —
    // esa anomalía ya la cubre el trigger descal_parse_failed.
    if (parsed.score_general !== null && parsed.score_general < 50 && parsed.descalificacion !== null && parsed.descalificacion.length === 0) {
      const rawTail = (lastRawOutput || "").slice(-2500).replace(/\s+/g, " ");
      const diagMsg = `LOW_SCORE_NO_DESCAL score=${parsed.score_general} descalCats_available=${descalCats.length} raw_descal_section=${(lastRawOutput || "").includes("DESCALIFICACION") ? "FOUND_IN_OUTPUT" : "NOT_IN_OUTPUT"} | RAW_TAIL: ${rawTail}`;
      console.warn(`[analyze] ${diagMsg} job=${jobId}`);
      await writeJobDiagnostic(jobId, diagMsg);
    }

    // 9. Write results
    // F48a: fragmento → unscorable_reason='fragmento' con score/clasificacion
    // NULL reales (payload null-safe); phasesWithIds=[] garantiza cero filas de
    // fases. updateUserStats corre IGUAL: un fragmento SÍ cuenta para el streak
    // (la captadora trabajó y subió la llamada — criterio del chat, 7-ago) y no
    // toca current_focus_phase (sin filas de fase no entra a la ventana de 5).
    await writeAnalysisResults(analysisId, parsed, job, descalCats, orgStages, isFragment ? "fragmento" : null, desempeno.score);
    await writeAnalysisPhases(analysisId, phasesWithIds, job.organization_id, job.user_id);
    await updateUserStats(job.user_id, job.organization_id);
    await completeAnalysisJob(analysisId);

    // 10. Second Claude call for tracker-based highlights (non-blocking on failure)
    // F48a: sin highlights para fragmentos — el output es feedback breve y el
    // segundo call asume contexto con score numérico.
    if (!isFragment) try {
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
    // F40 1b: clasificación en origen — el tipo del error sobrevive hasta aquí
    const errorKind = classifyError(err);
    console.error(`[analyze] Error processing job ${jobId}: ${msg} error_kind=${errorKind}`);

    if (analysisId) {
      try { await failAnalysis(analysisId, msg); } catch { /* best effort */ }
    }

    try {
      const job = await getJob(jobId);
      await failJob(jobId, msg, job.retry_count, job.max_retries, errorKind);
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
    throw new ApiStatusError(uploadRes.status, "assemblyai", `AssemblyAI upload failed: ${uploadRes.status}`);
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
    throw new ApiStatusError(transcriptRes.status, "assemblyai", `AssemblyAI transcript request failed: ${transcriptRes.status}`);
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
      throw new ApiStatusError(pollRes.status, "assemblyai", `AssemblyAI polling failed: ${pollRes.status}`);
    }
    const pollData = await pollRes.json();
    if (pollData.status === "completed") {
      if (!pollData.text || pollData.text.trim().length === 0) {
        throw new AudioContentError("No se detectó audio hablado en la grabación");
      }
      return pollData.text;
    }
    if (pollData.status === "error") {
      // NO alert — pollData.status='error' es per-audio failure (audio corrupt
      // o no procesable), no infra. Plan G captura esto downstream como
      // analyses.status='rechazado'.
      throw new AudioContentError(`AssemblyAI error: ${pollData.error || "unknown"}`);
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
