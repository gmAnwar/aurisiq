// F21: post Slack alert con dedupe via Postgres RPC try_alert.
// Espejo del helper Worker (worker/src/index.js alertSlack) — mismo contrato,
// runtime distinto (Deno vs Workers JS).
//
// Fail modes: fail closed (skip alert) si webhook no configured o RPC down.

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env.ts";

export interface AlertContext {
  organization_id: string | null;
  user_id: string | null;
}

export interface AlertPayload {
  service: string; // 'anthropic' | 'anthropic_highlights' | 'assemblyai' | 'smoke_test' | 'parser'
  error_code: string;
  error_message: string;
  runtime: "edge_function";
  organization_id?: string | null;
  user_id?: string | null;
  // F46: solo lo consume parser:partial_extraction — id para diagnosticar contra
  // la DB (analysis_parser_debug). NUNCA mandar raw/PII a Slack, solo el id.
  analysis_id?: string | null;
}

interface AlertResult {
  sent: boolean;
  reason?: string;
}

export async function alertSlack(payload: AlertPayload): Promise<AlertResult> {
  const webhookUrl = Deno.env.get("SLACK_ALERT_WEBHOOK_URL");
  if (!webhookUrl) {
    console.log("[F21] webhook_not_configured, skipping");
    return { sent: false, reason: "not_configured" };
  }

  const errorType = `${payload.service}:${payload.error_code}`;

  let shouldAlert = true;
  let orgSlug: string | null = null;
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/try_alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        _error_type: errorType,
        _runtime: payload.runtime,
        _organization_id: payload.organization_id || null,
      }),
    });
    if (!rpcRes.ok) {
      console.error("[F21] dedupe_rpc_failed", rpcRes.status);
      return { sent: false, reason: "dedupe_rpc_failed" };
    }
    const rows = await rpcRes.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    shouldAlert = !!row?.should_alert;
    orgSlug = row?.organization_slug || null;
  } catch (err) {
    console.error("[F21] dedupe_exception", (err as Error).message);
    return { sent: false, reason: "dedupe_exception" };
  }

  if (!shouldAlert) {
    console.log(`[F21] dedupe_hit ${errorType} runtime=${payload.runtime}`);
    return { sent: false, reason: "deduped" };
  }

  // sv-SE locale produce "YYYY-MM-DD HH:MM:SS" iso-like.
  const ts = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
  // F46: línea propia (no dentro de detail, que trunca a 500). Solo aparece
  // cuando el payload la trae — no ensucia alertas anthropic/assemblyai.
  const analysisLine = payload.analysis_id ? `\nanalysis: ${payload.analysis_id}` : "";
  const text = `🚨 F21 ${errorType} (${payload.runtime})
org: ${orgSlug || payload.organization_id || "unknown"}
user: ${payload.user_id || "unknown"}${analysisLine}
time: ${ts} CST
detail: ${(payload.error_message || "no detail").slice(0, 500)}`;

  try {
    const slackRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!slackRes.ok) {
      console.error("[F21] slack_post_failed", slackRes.status);
      return { sent: false, reason: "slack_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[F21] slack_post_exception", (err as Error).message);
    return { sent: false, reason: "slack_exception" };
  }
}

// Parse Anthropic 400/4xx body to extract error.type + error.message.
// Anthropic returns { "type": "error", "error": { "type": "invalid_request_error", "message": "..." } }
export function parseAnthropicError(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.type && parsed?.error?.message) {
      return `${parsed.error.type}: ${parsed.error.message}`;
    }
  } catch {
    // not JSON
  }
  return rawText;
}
