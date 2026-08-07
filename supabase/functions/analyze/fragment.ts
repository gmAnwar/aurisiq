// F48a: gate de fragmento — transcript demasiado corto para puntuar el
// desempeño. Módulo PURO (solo importa types + prompt-blocks) para que la
// suite Deno lo pueda testear: index.ts no puede exportar testables porque su
// top-level ejecuta Deno.serve — la constante y el gate viven aquí y index.ts
// los importa.
import type { ParsedOutput, Scorecard, ScorecardStructure, DescalCategory } from "./types.ts";
import { REJECTION_INSTRUCTION_BLOCK, PROSPECT_BLOCK_LEGACY, buildDescalBlock } from "./prompt-blocks.ts";
import { parseClaudeOutput } from "./parser.ts";

// Umbral del gate pre-LLM. Evidencia (F48 Fase 0 sobre 85 análisis completados,
// 6-ago-2026): banda <1,500 chars → score prom 16.5 (n=6, 4/6 con lead_quality
// indeterminado — conversación cortada, fases no alcanzadas); banda 1,500-2,000
// → prom 32 (n=4) e incluye llamadas completas reales (un lead calificado con
// 1,893 chars y la descalificación canónica con causal de 1,909 chars) —
// cortar en 2,000 las destruiría. Comparación ESTRICTA: <1500 es fragmento,
// exactamente 1500 NO lo es.
export const FRAGMENT_MIN_CHARS = 1500;

// Vacío, null o solo whitespace también son fragmento (no hay nada que
// puntuar). Un fragmento NO se puntúa: score_general y clasificacion quedan
// NULL POR DISEÑO y analyses.unscorable_reason='fragmento'. Precedencia:
// status='rechazado' gana — el branch de rechazo (tool_use) corre en index.ts
// ANTES de cualquier write de fragmento, y rejectAnalysis nunca escribe
// unscorable_reason.
export function isFragmentTranscript(transcription: string | null | undefined): boolean {
  if (!transcription || transcription.trim().length === 0) return true;
  return transcription.length < FRAGMENT_MIN_CHARS;
}

// Prompt bifurcado para fragmentos: SOLO feedback breve y accionable + estado
// del lead + extracción de datos del prospecto. SIN fases, SIN SCORE GENERAL,
// SIN clasificación, SIN checklist/etapa. Reutiliza los mismos labels y
// separadores `---` que los templates normales para que parseClaudeOutput
// funcione sin cambios (los regex de SIGUIENTE PASO y ESTADO DEL LEAD exigen
// el separador antes del header). Regla F42: los bloques se enumeran COMPLETOS
// incluyendo ESTADO DEL LEAD + cláusula anti-fusión.
export function buildFragmentPrompt(
  scorecard: Scorecard,
  descalCats: DescalCategory[],
): { systemPrompt: string; extractionPatterns: ScorecardStructure["extraction_patterns"] | null } {
  const structure = (scorecard.structure || {}) as ScorecardStructure;
  const vertical = scorecard.vertical || "inmobiliario";

  const dbProspectFields = Array.isArray(structure.prospect_fields) && structure.prospect_fields.length > 0
    ? structure.prospect_fields : null;
  const dbExtractionPatterns = Array.isArray(structure.extraction_patterns) && structure.extraction_patterns.length > 0
    ? structure.extraction_patterns : null;
  const prospectFields = dbProspectFields
    ? dbProspectFields.map(f => `${f.key}: [${f.instruction}]`).join("\n")
    : PROSPECT_BLOCK_LEGACY[vertical] || PROSPECT_BLOCK_LEGACY.inmobiliario;

  let prompt = `Eres AurisIQ, un sistema especializado en análisis de conversaciones de ventas. Esta transcripción es un FRAGMENTO: es demasiado corta para evaluar el desempeño de quien atendió la llamada. NO generes SCORE GENERAL, NO evalúes fases, NO asignes clasificación — cualquier calificación sobre un fragmento sería inventada.

Tu output tiene exactamente 2 bloques en este orden: Siguiente Paso con este Prospecto, y Estado del Lead. Los 2 bloques son obligatorios en cada respuesta, incluyendo ESTADO DEL LEAD como bloque separado — nunca los fusiones ni omitas ninguno. Después de los bloques van las líneas de extracción de datos.

Genera tu respuesta en este formato exacto:

---

SIGUIENTE PASO CON ESTE PROSPECTO

Acción concreta: [2-4 oraciones breves y accionables sobre qué hacer AHORA con este prospecto, dado lo poco que el fragmento permite leer. Específico, no genérico. Si el fragmento sugiere urgencia (interés vivo, cita mencionada, llamada cortada a la mitad), dilo explícito — un seguimiento inmediato puede rescatar la oportunidad.]

---

ESTADO DEL LEAD

Calidad del lead: [calificado / descalificado / indeterminado — con un fragmento lo honesto casi siempre es indeterminado; usa descalificado SOLO si el fragmento muestra una causal explícita, y calificado SOLO con evidencia clara]
Resultado de esta conversación: [cerrado_completo / cerrado_parcial / pospuesto_con_agenda / pospuesto_sin_agenda / descalificado / perdido]

---

EXTRACCION DE DATOS DEL PROSPECTO
Al final de tu respuesta, incluye estas líneas:
${prospectFields}

IDIOMA: Responde completamente en español. No uses anglicismos ni palabras en inglés (no "follow-up", "goodwill", "call to action"). Usa los equivalentes en español: seguimiento, prospecto, cierre.`;

  prompt += buildDescalBlock(descalCats);

  // Precedencia rechazado > fragmento: el fragmento CONSERVA la capacidad de
  // rechazo (2 de los 9 rechazados históricos están bajo 1,500 chars). El
  // bloque canónico menciona "análisis normal (con SCORE GENERAL...)" — la
  // nota siguiente resuelve esa contradicción para el caso fragmento sin
  // bifurcar el bloque (fuente única).
  prompt += REJECTION_INSTRUCTION_BLOCK;
  prompt += `

NOTA PARA ESTE FRAGMENTO: si el audio SÍ es analizable como conversación de venta, el "análisis normal" aquí es el formato de 2 bloques indicado arriba (SIN SCORE GENERAL ni fases). El criterio de rechazo del audio no cambia.`;

  return { systemPrompt: prompt, extractionPatterns: dbExtractionPatterns };
}

// El formato de fragmento abre con "---": si el modelo arranca su output en el
// separador (posición 0), los regex \n---\n del parser no anclan y el bloque
// SIGUIENTE PASO — el feedback, lo único que un fragmento entrega — se
// perdería. El \n inicial es monotónico: solo crea matches donde no había
// ninguno (mismo argumento que el des-escape F42d). Fuente única: index.ts y
// los tests parsean fragmentos SOLO por aquí.
export function parseFragmentOutput(
  rawOutput: string,
  extractionPatterns: { key: string; regex: string; column: string }[] | null,
): ParsedOutput {
  return parseClaudeOutput("\n" + rawOutput, extractionPatterns);
}
