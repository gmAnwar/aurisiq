// F40 Fase 1b: regresión del mapeo condición → error_kind y guard estático
// del SQL de redrive (la exclusión del literal orphan es INCONDICIONAL).
// Correr con: deno test --no-check --allow-read supabase/functions/_shared/errors.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiStatusError, AudioContentError, classifyError, RejectedAnalysisError } from "./errors.ts";

Deno.test("F40 1b: 5xx Anthropic → infra_transient", () => {
  assertEquals(classifyError(new ApiStatusError(529, "anthropic", "Claude API error: 529 overloaded")), "infra_transient");
  assertEquals(classifyError(new ApiStatusError(500, "anthropic", "Claude API error: 500")), "infra_transient");
  assertEquals(classifyError(new ApiStatusError(503, "assemblyai", "AssemblyAI upload failed: 503")), "infra_transient");
});

Deno.test("F40 1b: 404/400 (model not found / modelo retirado) → needs_deploy", () => {
  assertEquals(classifyError(new ApiStatusError(404, "anthropic", "Claude API error: 404 model not found")), "needs_deploy");
  assertEquals(classifyError(new ApiStatusError(400, "anthropic", "Claude API error: 400 invalid_request")), "needs_deploy");
});

Deno.test("F40 1b: 429 → quota", () => {
  assertEquals(classifyError(new ApiStatusError(429, "anthropic", "Claude API error: 429 rate limit")), "quota");
  assertEquals(classifyError(new ApiStatusError(429, "assemblyai", "AssemblyAI upload failed: 429")), "quota");
});

Deno.test("F40 1b: RejectedAnalysisError y per-audio → content", () => {
  assertEquals(classifyError(new RejectedAnalysisError("No es una llamada de ventas válida")), "content");
  assertEquals(classifyError(new AudioContentError("No se detectó audio hablado en la grabación")), "content");
  assertEquals(classifyError(new AudioContentError("AssemblyAI error: audio corrupt")), "content");
});

Deno.test("F40 1b: ambiguo → infra_transient (default conservador)", () => {
  assertEquals(classifyError(new Error("Claude response truncated by max_tokens")), "infra_transient");
  assertEquals(classifyError(new Error("network timeout")), "infra_transient");
  assertEquals(classifyError("string raro"), "infra_transient");
  assertEquals(classifyError(null), "infra_transient");
});

// Guard estático del SQL: la exclusión del literal orphan debe ser
// INCONDICIONAL — si un refactor la fusiona con el filtro p_error_kind, un
// redrive por 'infra_transient' resucitaría los kills del cron huérfano.
Deno.test("F40 1b: redrive SQL — exclusión orphan incondicional, separada del filtro por kind", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../migrations/20260708014646_f40_fase1b_error_kind_classification.sql", import.meta.url),
  );
  const lines = sql.split("\n");
  const exclusionLine = lines.find((l) =>
    l.includes("IS DISTINCT FROM 'Worker crashed or timed out after 5 minutes'")
  );
  // 1. La exclusión existe
  assertEquals(exclusionLine !== undefined, true, "falta la exclusión del literal orphan");
  // 2. Y NO está condicionada por p_error_kind en la misma expresión
  assertEquals(exclusionLine!.includes("p_error_kind"), false, "la exclusión orphan quedó condicionada a p_error_kind");
  // 3. El filtro por kind existe como AND adicional independiente
  assertStringIncludes(sql, "AND (p_error_kind IS NULL OR error_kind = p_error_kind)");
  // 4. Los kills del cron clasifican infra_transient (lo que hace crítica la exclusión)
  assertStringIncludes(sql, "COALESCE(error_kind, 'infra_transient')");
});
