// Decide QUÉ VE la captadora cuando una transcripción no sale.
//
// Incidente 2026-08-20: RecordingContext.transcribeAudioBlob devolvía `null`
// en cinco caminos distintos (blob chico, blob grande, 0 palabras, error del
// Worker, catch de red) y el handler ponía la barra al 100% con
// "Transcripción lista" ANTES de mirar el resultado. La captadora veía la
// palabra "lista", volvía a un formulario vacío y reportaba "no se guardó".
//
// Regla que fija este módulo: NINGÚN camino devuelve "no pasó nada". Todo
// fallo sale con un userMessage en es-MX que la captadora pueda accionar.
//
// Vive fuera del contexto porque probar el contexto exige mockear
// MediaRecorder + FileReader + fetch; esto es aritmética de strings y se
// prueba directo desde supabase/functions/_shared/transcription-outcome.test.ts.

export interface TranscribeSuccess {
  ok: true;
  text: string;
  original: string;
  message: string;
}

export interface TranscribeFailure {
  ok: false;
  userMessage: string;
}

export type TranscribeOutcome = TranscribeSuccess | TranscribeFailure;

/**
 * Guard explícito para la rama de fallo.
 *
 * El proyecto compila con `strict: false`, y sin strictNullChecks TypeScript
 * NO estrecha la unión con `if (!outcome.ok)` (el narrowing positivo sí
 * funciona, el negativo no). Sin esto, leer `outcome.userMessage` en la rama
 * de error no compila.
 */
export function isTranscribeFailure(outcome: TranscribeOutcome): outcome is TranscribeFailure {
  return outcome.ok === false;
}

export const MIN_AUDIO_BYTES = 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// El Worker legacy corta en 15,000 chars (regla vigente en CLAUDE.md). El
// cliente recorta antes para que la captadora vea exactamente el texto que
// se va a analizar. Este número NO se toca en esta tarea: la divergencia
// contra los límites de /analisis/nueva (20,000 telefónico / 60,000
// presencial) es deuda conocida y va en tarea aparte.
export const CLIENT_TRANSCRIPT_MAX_CHARS = 15000;

// "El audio salió, pero salió mal": pocas palabras para el tiempo grabado.
// No bloquea el análisis — avisa.
const LOW_QUALITY_MIN_WORDS = 50;
const LOW_QUALITY_MIN_ELAPSED_SECONDS = 120;

export const TRANSCRIBE_MESSAGES = {
  noAudio: "La grabación no captó audio. Verifica que el altavoz esté encendido e intenta de nuevo.",
  tooLarge: "El audio excede 25MB. Intenta con un archivo más corto.",
  network: "No pudimos transcribir el audio. Revisa tu conexión e intenta de nuevo.",
  offlineQueued: "Sin conexión — se enviará automáticamente cuando haya internet.",
  lowQuality: "La calidad del audio parece baja. Revisa que el micrófono esté captando la conversación.",
  ready: "Transcripción automática lista — revisa antes de analizar.",
} as const;

export function truncatedMessage(maxChars: number): string {
  return `La transcripción es muy larga. Se mostrarán los primeros ${maxChars.toLocaleString("es-MX")} caracteres.`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Gate de tamaño del blob. `null` = el blob sirve, sigue el flujo.
 *
 * Un blob por debajo de MIN_AUDIO_BYTES es un contenedor sin muestras: la
 * grabación no captó nada (altavoz apagado, mic tomado por la llamada nativa
 * en iOS, corte inmediato). Antes se devolvía null mudo desde aquí.
 */
export function checkBlobSize(size: number): TranscribeFailure | null {
  if (size < MIN_AUDIO_BYTES) return { ok: false, userMessage: TRANSCRIBE_MESSAGES.noAudio };
  if (size > MAX_AUDIO_BYTES) return { ok: false, userMessage: TRANSCRIBE_MESSAGES.tooLarge };
  return null;
}

/**
 * Respuesta !ok del Worker → mensaje para la captadora.
 *
 * El Worker ya manda es-MX accionable en sus ramas explícitas: 400 "No se
 * detectó audio hablado en la grabación", 403 read-only, 504 "La
 * transcripción está tomando demasiado tiempo". Esos se muestran TAL CUAL.
 * El 500 genérico devuelve `err.message` crudo (inglés, errores de
 * AssemblyAI): ahí va el mensaje de red, no el stack.
 */
export function outcomeForWorkerError(status: number, rawError: string): TranscribeFailure {
  const raw = (rawError || "").trim();
  if (/audio exceeds/i.test(raw)) return { ok: false, userMessage: TRANSCRIBE_MESSAGES.tooLarge };
  if (status >= 500 && status !== 504) return { ok: false, userMessage: TRANSCRIBE_MESSAGES.network };
  return { ok: false, userMessage: raw || TRANSCRIBE_MESSAGES.network };
}

/**
 * Respuesta ok del Worker → texto usable, o fallo con mensaje.
 *
 * `elapsedSeconds` es la duración de la grabación: solo sirve para decidir
 * si el resultado corto merece la advertencia de calidad.
 */
export function outcomeForWorkerText(
  rawText: unknown,
  elapsedSeconds: number,
  maxChars: number = CLIENT_TRANSCRIPT_MAX_CHARS,
): TranscribeOutcome {
  const text = typeof rawText === "string" ? rawText : "";
  const words = countWords(text);

  // Defensivo: el Worker ya devuelve 400 cuando AssemblyAI no sacó texto,
  // pero un 200 vacío tampoco se pierde en silencio.
  if (words === 0) return { ok: false, userMessage: TRANSCRIBE_MESSAGES.noAudio };

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    return { ok: true, text: cut, original: cut, message: truncatedMessage(maxChars) };
  }

  const message = words < LOW_QUALITY_MIN_WORDS && elapsedSeconds > LOW_QUALITY_MIN_ELAPSED_SECONDS
    ? TRANSCRIBE_MESSAGES.lowQuality
    : TRANSCRIBE_MESSAGES.ready;

  return { ok: true, text, original: text, message };
}
