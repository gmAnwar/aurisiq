/**
 * Thrown when Claude determines the audio is not a valid sales call
 * (silent, wrong language, internal conversation, etc.).
 *
 * Distinguishes from generic Error to allow:
 * - failJob/failAnalysis to set status='rejected'/'rechazado' instead of 'error'
 * - Skip retries (rejection is deterministic)
 * - Frontend to render specific UX
 */
export class RejectedAnalysisError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "RejectedAnalysisError";
  }
}

/**
 * F40 1b: error de API externa con status HTTP ESTRUCTURADO (Anthropic o
 * AssemblyAI). Antes el status viajaba embebido en err.message y el catch
 * global no podía clasificar el error en origen.
 */
export class ApiStatusError extends Error {
  constructor(
    public statusCode: number,
    public service: "anthropic" | "assemblyai",
    message: string,
  ) {
    super(message);
    this.name = "ApiStatusError";
  }
}

/**
 * F40 1b: fallo per-audio de AssemblyAI (audio corrupto, sin voz detectable).
 * El problema es el INPUT, no la infraestructura — reintentar no ayuda.
 */
export class AudioContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioContentError";
  }
}

// ─── F40 1b: clasificación de errores en origen ─────────────

export type ErrorKind = "infra_transient" | "needs_deploy" | "content" | "quota";

/**
 * Mapeo canónico condición → error_kind (diseño S47 / F40 Fase 1b):
 * - quota: 429 de cualquier API (+ cuota interna, que pasa "quota" directo a failJob)
 * - needs_deploy: 404 (model not found) / 400 (modelo retirado, payload inválido)
 *   — determinístico hasta que un deploy o config lo arregle
 * - content: RejectedAnalysisError (no es venta válida) y fallos per-audio
 * - infra_transient: 5xx, timeouts, network, y TODO caso ambiguo (default
 *   conservador para futuro auto-redrive: lo peor es un retry inútil,
 *   nunca un skip de fix).
 */
export function classifyError(err: unknown): ErrorKind {
  if (err instanceof RejectedAnalysisError || err instanceof AudioContentError) return "content";
  if (err instanceof ApiStatusError) {
    if (err.statusCode === 429) return "quota";
    if (err.statusCode === 404 || err.statusCode === 400) return "needs_deploy";
    return "infra_transient";
  }
  return "infra_transient";
}
