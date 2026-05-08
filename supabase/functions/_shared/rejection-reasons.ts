/**
 * Categorías de rechazo del audio cuando no es analizable como conversación
 * de captación o venta. La Edge Function de analyze recibe esta señal vía
 * tool_use estructurado (tool `report_audio_not_analyzable`) y mapea cada
 * enum a texto humano en español MX para mostrar a la captadora.
 *
 * NO confundir con descalificación del lead/prospecto durante una llamada
 * válida — esos casos son análisis NORMAL (ver REJECTION_INSTRUCTION_BLOCK
 * en claude.ts).
 */

export type RejectionReason =
  | "audio_sin_habla"
  | "no_es_conversacion_de_venta"
  | "idioma_no_soportado"
  | "otro";

export const REJECTION_REASON_LABELS_ES_MX: Record<RejectionReason, string> = {
  audio_sin_habla: "El audio no contiene voz audible.",
  no_es_conversacion_de_venta:
    "El audio no parece ser una llamada de captación o venta.",
  idioma_no_soportado: "El audio no está en español.",
  otro: "Audio no analizable",
};

const OTRO_PREFIX = "Audio no analizable: ";
const OTRO_FALLBACK = "Audio no analizable.";
const MAX_LEN = 300;

export function mapRejectionToHumanText(
  reason: RejectionReason,
  details?: string,
): string {
  if (reason !== "otro") {
    return REJECTION_REASON_LABELS_ES_MX[reason];
  }
  const trimmed = (details || "").trim();
  if (!trimmed) return OTRO_FALLBACK;
  const combined = `${OTRO_PREFIX}${trimmed}`;
  if (combined.length <= MAX_LEN) return combined;
  return `${combined.slice(0, MAX_LEN - 1)}…`;
}

const VALID_REASONS = new Set<string>([
  "audio_sin_habla",
  "no_es_conversacion_de_venta",
  "idioma_no_soportado",
  "otro",
]);

export function isRejectionReason(s: string): s is RejectionReason {
  return VALID_REASONS.has(s);
}
