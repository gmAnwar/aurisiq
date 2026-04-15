// Background upload of pending recordings to Supabase Storage
// + creation of background_jobs for Edge Function processing

import { supabase } from "./supabase";
import {
  getAllRecordings,
  updateRecordingStatus,
  type PendingRecording,
} from "./recordings-queue";

const BACKOFF_MS = [10_000, 30_000, 90_000, 180_000, 600_000]; // 10s, 30s, 90s, 3min, 10min
const MAX_ATTEMPTS = 5;
const EDGE_FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze`;

// ─── Upload single recording ─────────────────────────────

export async function uploadRecording(rec: PendingRecording): Promise<void> {
  if (rec.status === "uploading" || rec.status === "completed" || rec.status === "analyzing") return;

  await updateRecordingStatus(rec.id, "uploading");

  try {
    const ext = rec.mime_type.includes("mp4") ? "mp4" : "webm";
    const path = `${rec.organization_id}/${rec.user_id}/${rec.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(path, rec.audio_blob, {
        contentType: rec.mime_type,
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage.from("recordings").getPublicUrl(path);

    await updateRecordingStatus(rec.id, "uploaded", {
      uploaded_audio_url: urlData?.publicUrl || path,
      attempt_count: rec.attempt_count + 1,
      last_error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown upload error";
    const attempts = rec.attempt_count + 1;
    await updateRecordingStatus(rec.id, attempts >= MAX_ATTEMPTS ? "error" : "pending", {
      attempt_count: attempts,
      last_error: msg,
    });
    throw err;
  }
}

// ─── Submit uploaded recording for analysis ───────────────

export async function submitForAnalysis(rec: PendingRecording): Promise<string> {
  if (rec.status !== "uploaded") throw new Error("Recording must be uploaded first");
  if (!rec.uploaded_audio_url) throw new Error("No uploaded URL");

  await updateRecordingStatus(rec.id, "analyzing");

  try {
    // Create background_jobs row for the Edge Function to process
    const { data: job, error: insertError } = await supabase
      .from("background_jobs")
      .insert({
        organization_id: rec.organization_id,
        user_id: rec.user_id,
        type: "analysis",
        status: "pending",
        priority: 0,
        payload: {
          transcription_text: "", // Will be filled by Edge Function after transcription
          scorecard_id: rec.scorecard_id,
          funnel_stage_id: rec.funnel_stage_id || null,
          fuente_lead_id: null,
          prospect_phone: null,
          transcription_original: null,
          transcription_edited: null,
          edit_percentage: 0,
          call_notes: rec.notes || null,
          has_audio: true,
          pause_count: 0,
          total_paused_seconds: 0,
          avanzo_a_siguiente_etapa: "pending",
          audio_storage_path: rec.uploaded_audio_url,
        },
        max_retries: 2,
      })
      .select("id")
      .single();

    if (insertError || !job) throw new Error(`Failed to create job: ${insertError?.message}`);

    // Invoke edge function
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ job_id: job.id }),
    });

    await updateRecordingStatus(rec.id, "analyzing", { analysis_id: job.id });
    return job.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await updateRecordingStatus(rec.id, "uploaded", { last_error: msg });
    throw err;
  }
}

// ─── Process entire queue ─────────────────────────────────

export async function processQueue(userId: string): Promise<void> {
  const recordings = await getAllRecordings(userId);

  for (const rec of recordings) {
    if (rec.incomplete) continue;

    // Upload pending recordings
    if (rec.status === "pending") {
      try {
        await uploadRecording(rec);
      } catch {
        // Will retry on next processQueue call
        continue;
      }
    }
  }
}

// ─── Retry failed uploads ─────────────────────────────────

export async function retryFailed(userId: string): Promise<number> {
  const recordings = await getAllRecordings(userId);
  const failed = recordings.filter(r => r.status === "error");
  let retried = 0;

  for (const rec of failed) {
    await updateRecordingStatus(rec.id, "pending", { attempt_count: 0, last_error: null });
    try {
      await uploadRecording({ ...rec, status: "pending", attempt_count: 0 });
      retried++;
    } catch {
      // Will show as error again
    }
  }

  return retried;
}

// ─── Upload with retry and backoff ────────────────────────

export async function uploadWithRetry(rec: PendingRecording): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await uploadRecording({ ...rec, attempt_count: attempt });
      return; // Success
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[attempt]));
      }
    }
  }
  // Final failure already marked as "error" by uploadRecording
}

// ─── Poll for analysis completion ─────────────────────────

export async function checkAnalysisStatus(jobId: string): Promise<{ status: string; analysisId: string | null }> {
  const { data } = await supabase
    .from("background_jobs")
    .select("status, result")
    .eq("id", jobId)
    .single();

  if (!data) return { status: "unknown", analysisId: null };
  return {
    status: data.status,
    analysisId: (data.result as { analysis_id?: string })?.analysis_id || null,
  };
}
