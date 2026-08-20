// Gates de lib/transcription-outcome.ts — los 4 caminos de fallo que antes
// devolvían `null` mudo (incidente 2026-08-20: la captadora veía
// "Transcripción lista" con el textarea vacío).
//
// Regla S53: cada gate se valida por mutación. El invariante que sostiene
// todo el fix es el último test: NINGÚN fallo sale sin userMessage.
//
// Vive bajo supabase/functions/ porque tsconfig.json excluye ese árbol — así
// el import remoto de std/assert no entra al typecheck de Next.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkBlobSize,
  outcomeForWorkerError,
  outcomeForWorkerText,
  CLIENT_TRANSCRIPT_MAX_CHARS,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_BYTES,
  TRANSCRIBE_MESSAGES,
  truncatedMessage,
  type TranscribeFailure,
} from "../../../lib/transcription-outcome.ts";

// ─── Camino 1: blob sin audio / demasiado grande ────────────

Deno.test("checkBlobSize: blob por debajo del mínimo avisa que no captó audio", () => {
  const r = checkBlobSize(512);
  assertEquals(r?.ok, false);
  assertEquals(r?.userMessage, TRANSCRIBE_MESSAGES.noAudio);
});

Deno.test("checkBlobSize: blob vacío (0 bytes) también avisa", () => {
  assertEquals(checkBlobSize(0)?.userMessage, TRANSCRIBE_MESSAGES.noAudio);
});

Deno.test("checkBlobSize: el mínimo es inclusivo — exactamente 1024 pasa", () => {
  // Mata el mutante <= : si el gate fuera `size <= MIN`, un blob de 1024
  // bytes se rechazaría y perderíamos una grabación válida.
  assertEquals(checkBlobSize(MIN_AUDIO_BYTES), null);
});

Deno.test("checkBlobSize: blob por encima de 25MB avisa del tamaño, no de audio", () => {
  const r = checkBlobSize(MAX_AUDIO_BYTES + 1);
  assertEquals(r?.userMessage, TRANSCRIBE_MESSAGES.tooLarge);
});

Deno.test("checkBlobSize: el máximo es inclusivo — exactamente 25MB pasa", () => {
  assertEquals(checkBlobSize(MAX_AUDIO_BYTES), null);
});

// ─── Camino 2: el Worker responde con error ─────────────────

Deno.test("outcomeForWorkerError: 400 'no se detectó audio' se muestra TAL CUAL", () => {
  // Este es el mensaje que el Worker ya generaba y que el `catch { return
  // null }` se comía. Es la razón de ser del fix.
  const msg = "No se detectó audio hablado en la grabación";
  assertEquals(outcomeForWorkerError(400, msg).userMessage, msg);
});

Deno.test("outcomeForWorkerError: 403 read-only se muestra tal cual", () => {
  const msg = "Organization is in read-only mode";
  assertEquals(outcomeForWorkerError(403, msg).userMessage, msg);
});

Deno.test("outcomeForWorkerError: 504 conserva el mensaje es-MX del Worker", () => {
  // Mata el mutante `status >= 500 -> network` sin la excepción de 504: ese
  // mensaje es accionable ("intenta con un audio más corto") y perderlo
  // dejaría a la captadora sin saber qué hacer.
  const msg = "La transcripción está tomando demasiado tiempo. Intenta con un audio más corto.";
  assertEquals(outcomeForWorkerError(504, msg).userMessage, msg);
});

Deno.test("outcomeForWorkerError: 500 NO filtra el error técnico crudo", () => {
  // El 500 genérico del Worker devuelve err.message: inglés, stack de
  // AssemblyAI. Mata el mutante que muestra `raw` para todos los status.
  const raw = "AssemblyAI upload failed: 503 upstream connect error";
  const r = outcomeForWorkerError(500, raw);
  assertEquals(r.userMessage, TRANSCRIBE_MESSAGES.network);
  assert(!r.userMessage.includes("AssemblyAI"));
});

Deno.test("outcomeForWorkerError: el error de tamaño legacy se normaliza a es-MX", () => {
  assertEquals(
    outcomeForWorkerError(400, "Audio exceeds 25MB limit").userMessage,
    TRANSCRIBE_MESSAGES.tooLarge,
  );
});

Deno.test("outcomeForWorkerError: body sin error usable cae al mensaje de red", () => {
  // Mata el mutante que devuelve `raw` sin fallback: un body vacío dejaría
  // el banner en blanco, que es exactamente el bug original con otra cara.
  assertEquals(outcomeForWorkerError(400, "").userMessage, TRANSCRIBE_MESSAGES.network);
  assertEquals(outcomeForWorkerError(400, "   ").userMessage, TRANSCRIBE_MESSAGES.network);
});

// ─── Camino 3: el Worker responde 200 pero sin texto ────────

Deno.test("outcomeForWorkerText: texto vacío es fallo, no éxito silencioso", () => {
  const r = outcomeForWorkerText("", 130);
  assertEquals(r.ok, false);
  assertEquals((r as TranscribeFailure).userMessage, TRANSCRIBE_MESSAGES.noAudio);
});

Deno.test("outcomeForWorkerText: solo whitespace cuenta como sin audio", () => {
  assertEquals(outcomeForWorkerText("   \n\t  ", 130).ok, false);
});

Deno.test("outcomeForWorkerText: campo ausente o no-string cuenta como sin audio", () => {
  assertEquals(outcomeForWorkerText(undefined, 130).ok, false);
  assertEquals(outcomeForWorkerText(null, 130).ok, false);
});

// ─── Camino 4: texto usable ─────────────────────────────────

Deno.test("outcomeForWorkerText: llamada larga con pocas palabras avisa calidad baja", () => {
  const r = outcomeForWorkerText("hola que tal todo bien", 130);
  assert(r.ok);
  assertEquals(r.message, TRANSCRIBE_MESSAGES.lowQuality);
  // Sigue siendo ok:true — el aviso NO bloquea, el gate de MIN_WORDS del
  // formulario es el que decide si se puede analizar.
  assertEquals(r.text, "hola que tal todo bien");
});

Deno.test("outcomeForWorkerText: llamada corta con pocas palabras no dispara el aviso", () => {
  // Mata el mutante que quita la condición de elapsed: una llamada de 30s
  // con 5 palabras no es "calidad baja", es una llamada de 30s.
  const r = outcomeForWorkerText("hola que tal", 30);
  assert(r.ok);
  assertEquals(r.message, TRANSCRIBE_MESSAGES.ready);
});

Deno.test("outcomeForWorkerText: transcripción normal sale lista", () => {
  const text = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(" ");
  const r = outcomeForWorkerText(text, 400);
  assert(r.ok);
  assertEquals(r.message, TRANSCRIBE_MESSAGES.ready);
  assertEquals(r.text, text);
  assertEquals(r.original, text);
});

// "palabra " = 8 chars, así que N repeticiones dan exactamente 8N caracteres
// y N palabras. Fixture realista: una transcripción larga tiene palabras, no
// un solo token gigante (con un token único caería en el aviso de calidad).
const wordsOfLength = (chars: number) => "palabra ".repeat(Math.ceil(chars / 8)).slice(0, chars);

Deno.test("outcomeForWorkerText: texto sobre el límite se recorta y lo dice", () => {
  const text = wordsOfLength(CLIENT_TRANSCRIPT_MAX_CHARS + 500);
  const r = outcomeForWorkerText(text, 400);
  assert(r.ok);
  assertEquals(r.text.length, CLIENT_TRANSCRIPT_MAX_CHARS);
  assertEquals(r.original, r.text);
  assertEquals(r.message, truncatedMessage(CLIENT_TRANSCRIPT_MAX_CHARS));
});

Deno.test("outcomeForWorkerText: el límite es inclusivo — exactamente el máximo no se recorta", () => {
  // Mata el mutante `>=`: recortar en el límite exacto perdería un carácter
  // y marcaría como truncada una transcripción que cabe entera.
  const text = wordsOfLength(CLIENT_TRANSCRIPT_MAX_CHARS);
  const r = outcomeForWorkerText(text, 400);
  assert(r.ok);
  assertEquals(r.text.length, CLIENT_TRANSCRIPT_MAX_CHARS);
  assertEquals(r.text, text);
  assertEquals(r.message, TRANSCRIBE_MESSAGES.ready);
});

// ─── Invariante del fix ─────────────────────────────────────

Deno.test("INVARIANTE: ningún fallo sale sin mensaje accionable", () => {
  // Si algún camino vuelve a quedarse mudo, este test truena. Es el guard
  // del incidente completo.
  const failures: TranscribeFailure[] = [
    checkBlobSize(0)!,
    checkBlobSize(MAX_AUDIO_BYTES + 1)!,
    outcomeForWorkerError(400, "No se detectó audio hablado en la grabación"),
    outcomeForWorkerError(500, "boom"),
    outcomeForWorkerError(403, ""),
    outcomeForWorkerText("", 130) as TranscribeFailure,
  ];

  for (const f of failures) {
    assertEquals(f.ok, false);
    assert(typeof f.userMessage === "string", "userMessage debe ser string");
    assert(f.userMessage.trim().length > 10, `userMessage vacío o inútil: "${f.userMessage}"`);
  }
});

Deno.test("INVARIANTE: los mensajes de UI van en es-MX con tuteo, sin voseo", () => {
  // Regla de idioma del proyecto: español México, tuteo, cero voseo.
  const voseo = /\b(complet|agreg|eleg|sub|revis|intent|verific)á\b|\bpodés\b|\btenés\b/i;
  for (const [key, msg] of Object.entries(TRANSCRIBE_MESSAGES)) {
    assert(!voseo.test(msg), `voseo en TRANSCRIBE_MESSAGES.${key}: "${msg}"`);
  }
});
