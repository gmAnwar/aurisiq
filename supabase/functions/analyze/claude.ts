import { ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_API_URL, CLAUDE_MAX_TOKENS } from "../_shared/env.ts";
import type { Scorecard, ScorecardStructure, DescalCategory, FunnelStage } from "./types.ts";

// ─── Prompt building (Path A: structured) ─────────────────

function buildPromptFromStructure(
  structure: ScorecardStructure,
  vocabulary: { term: string; definition: string }[],
): string {
  const s = structure;
  const lines: string[] = [];

  lines.push(`Eres AurisIQ, un sistema especializado en análisis de conversaciones de ventas. ${s.objective || ""}`);
  if (s.context) lines.push(`\n${s.context}`);
  if (s.tone) lines.push(`\nCuando analices siempre: ${s.tone}`);

  if (vocabulary && vocabulary.length > 0) {
    lines.push(`\n---\nVOCABULARIO ESPECÍFICO DE ESTA ORGANIZACIÓN\nUsa estos términos tal como están definidos:`);
    for (const v of vocabulary) {
      lines.push(`- ${v.term}: ${v.definition}`);
    }
  }

  lines.push(`\nTu output tiene exactamente ${(s.output_blocks || []).length} bloques en este orden: ${(s.output_blocks || []).map(b => b.description).join(", ")}.`);
  lines.push(`\nEl usuario te enviará la transcripción. Genera el análisis en este formato exacto:`);

  const scoreBlock = (s.output_blocks || []).find(b => b.key === "score");
  if (scoreBlock) {
    lines.push(`\n---\n\n${scoreBlock.format_instruction}`);
  }

  lines.push(`\n---\n\nDIAGNÓSTICO POR FASE\n`);
  for (const phase of s.phases || []) {
    const criteriaDetail = (phase.criteria || [])
      .filter(c => c.detail)
      .map(c => c.detail)
      .join(". ");
    const baseText = phase.prompt_base || criteriaDetail || "";
    lines.push(`${phase.name} ([puntaje]/${phase.max_score}): [${baseText}]`);
  }

  const objBlock = (s.output_blocks || []).find(b => b.key === "objeciones");
  if (objBlock) {
    lines.push(`\n---\n\nOBJECIONES DETECTADAS\n\n[Por cada objeción presente:]\n${objBlock.format_instruction}`);
  }

  const nextBlock = (s.output_blocks || []).find(b => b.key === "siguiente_paso");
  if (nextBlock) {
    lines.push(`\n---\n\nSIGUIENTE PASO CON ESTE PROSPECTO\n\n${nextBlock.format_instruction}`);
  }

  const patternBlock = (s.output_blocks || []).find(b => b.key === "patron_error");
  if (patternBlock) {
    lines.push(`\n---\n\nPATRÓN DE ERROR PRINCIPAL\n\n${patternBlock.format_instruction}`);
  }

  return lines.join("\n");
}

// ─── Legacy constants (fallback, remove after 2026-05-12) ──

const PROSPECT_BLOCK_LEGACY: Record<string, string> = {
  inmobiliario: `PROSPECTO_NOMBRE: [nombre del prospecto si se menciona, o "No identificado"]
PROSPECTO_ZONA: [colonia, zona o municipio si se menciona, o "No identificada"]
TIPO_PROPIEDAD: [casa, departamento, terreno, local, o "No identificado"]
MOTIVO_VENTA: [razón por la que vende, o "No mencionado"]
PROSPECTO_TELEFONO: [número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o "No detectado"]`,
  financiero: `PROSPECTO_NOMBRE: [nombre del prospecto si se menciona, o "No identificado"]
PROSPECTO_ZONA: [colonia, zona o municipio del negocio si se menciona, o "No identificada"]
TIPO_NEGOCIO: [tortillería, tienda de abarrotes, taller, ambulante, etc. o "No mencionado"]
TIPO_EQUIPO: [horno, vitrina, refrigerador, máquina tortilladora, etc. o "No mencionado"]
PROSPECTO_TELEFONO: [número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o "No detectado"]`,
};

const CHECKLIST_BLOCK_LEGACY: Record<string, string> = {
  inmobiliario: `Los 26 campos del checklist son: Nombre completo, Dirección de la propiedad, Dirección INE, Estado civil, Libre de gravamen, Pagos puntuales, Adeudos en tiempo consecutivo, Crédito individual o conyugal, NSS, NC, Papelería/escrituras, Descripción del domicilio, Casa habitada o desocupada, Servicios a nombre de quién, Adeudos de servicios, Financiamiento de adeudos, Motivo de venta, Expectativa del cliente, Precio estimado de venta, Precio estimado de captación, Disponibilidad para visita, Fecha y hora propuesta, Lectura de urgencia, Lectura de disposición, Lectura de resistencia, Promesa de venta.`,
  financiero: `Los 14 campos del checklist son: Nombre del titular, Nombre del negocio, Tipo de negocio, Ubicación del negocio, Antigüedad del negocio, Ingresos mensuales estimados, Equipo que necesita financiar, Monto de crédito solicitado, Plazo deseado, Enganche disponible, Historial crediticio, Documentación disponible, Disponibilidad para visita, Fecha y hora propuesta.`,
};

const TONE_BLOCK = `\n\n---\nTONO Y FORMATO DEL PATRÓN DE ERROR\nEl bloque PATRÓN DE ERROR PRINCIPAL debe ser BREVE: máximo 2-3 oraciones concretas y accionables. Escribe el patrón en tono NEUTRO, sin segunda persona ("tú", "tu próxima llamada") ni primera ("mi recomendación"). Describe el comportamiento observable y la oportunidad de mejora directamente. Ejemplos correctos: "El cierre de objeción de precio fue débil — se cedió ante la primera resistencia sin reframear el valor.", "Falta exploración del motivo real de venta antes de hablar de precio.", "La pregunta sobre escrituras se hizo demasiado tarde en la conversación." Cada vista del producto enmarcará este texto con el tono apropiado para su audiencia. NUNCA uses "cometió un error", "falla más común", "error costoso".\n\nIDIOMA: Responde completamente en español. No uses anglicismos ni palabras en inglés (no "follow-up", "lead", "goodwill", "call to action", "closing"). Usa los equivalentes en español: seguimiento, prospecto, confianza, llamado a la acción, cierre.`;

// HIGHLIGHTS_BLOCK removed — highlights now generated in dedicated second call

// ─── Full prompt assembly ──────────────────────────────────

export function buildFullPrompt(
  scorecard: Scorecard,
  vocabulary: { term: string; definition: string }[],
  descalCats: DescalCategory[],
  orgStages: FunnelStage[],
  checklistItems: { label: string; description: string | null }[],
): { systemPrompt: string; extractionPatterns: ScorecardStructure["extraction_patterns"] | null } {
  const structure = (scorecard.structure || {}) as ScorecardStructure;

  const hasStructure = structure.phases && Array.isArray(structure.phases) && structure.phases.length > 0;
  const hasTemplate = !!scorecard.template_id;
  const legacyLen = (scorecard.prompt_template || "").length;
  const useStructured = hasStructure && hasTemplate && legacyLen < 500;

  console.log(`[analyze] path=${useStructured ? "A" : "B"} structure=${!!hasStructure} template_id=${!!hasTemplate} legacy_len=${legacyLen}`);

  let prompt: string;
  if (useStructured) {
    prompt = buildPromptFromStructure(structure, vocabulary);
  } else {
    prompt = scorecard.prompt_template;
  }
  prompt += TONE_BLOCK;

  // Resolve prospect fields
  const vertical = scorecard.vertical || "inmobiliario";
  const dbProspectFields = Array.isArray(structure.prospect_fields) && structure.prospect_fields.length > 0
    ? structure.prospect_fields : null;
  const dbExtractionPatterns = Array.isArray(structure.extraction_patterns) && structure.extraction_patterns.length > 0
    ? structure.extraction_patterns : null;

  const prospectFields = dbProspectFields
    ? dbProspectFields.map(f => `${f.key}: [${f.instruction}]`).join("\n")
    : PROSPECT_BLOCK_LEGACY[vertical] || PROSPECT_BLOCK_LEGACY.inmobiliario;

  prompt += `\n\n---\nEXTRACCION DE DATOS DEL PROSPECTO\nAl final de tu respuesta, incluye estas líneas:\n${prospectFields}`;

  // Checklist — dynamic from stage_checklist_items (DB), omit if none configured
  if (checklistItems.length > 0) {
    const itemList = checklistItems.map(i => i.description ? `- ${i.label}: ${i.description}` : `- ${i.label}`).join("\n");
    prompt += `\n\n---\nCHECKLIST A EVALUAR (${checklistItems.length} items configurados para esta etapa):\n\n${itemList}\n\nPara cada item, determina su estado:\n- "covered": el vendedor preguntó Y el prospecto respondió\n- "asked_no_answer": el vendedor preguntó pero el prospecto no pudo/quiso responder\n- "not_covered": el vendedor no preguntó\n\nResponde con una línea:\nCHECKLIST: [{"field":"label exacto","state":"covered|asked_no_answer|not_covered"}]\nUsa los labels EXACTOS de la lista anterior.`;
  }
  // No fallback — if stage has no items, checklist is omitted from prompt

  if (orgStages.length > 0) {
    const stageList = orgStages.map(s => `- ${s.name}`).join("\n");
    prompt += `\n\n---\nDETECCIÓN DE ETAPA DEL EMBUDO\nBasándote en el contenido de la conversación, identifica en cuál de estas etapas del embudo se encuentra esta llamada:\n${stageList}\n\nAl final de tu respuesta incluye una línea con el formato exacto:\nETAPA_DETECTADA: [nombre exacto de la etapa]\n\nUsa exactamente el nombre tal como aparece en la lista. Si no puedes determinar la etapa con confianza razonable, escribe:\nETAPA_DETECTADA: null`;
  }

  if (descalCats.length > 0) {
    const catList = descalCats.map(c => `- ${c.code}: ${c.label}`).join("\n");
    prompt += `\n\n---\nDESCALIFICACION DE LEADS\nAnaliza la transcripción y determina si el lead fue descalificado. Usa SOLO los siguientes códigos del catálogo de la organización:\n${catList}\n\nAl final de tu respuesta, incluye una línea con el formato:\nDESCALIFICACION: ["codigo1", "codigo2", "codigo3"]\nSi el lead calificó (no hay razón de descalificación), escribe:\nDESCALIFICACION: []\nMáximo 3 códigos. Usa SOLO códigos del catálogo anterior.\n\nINSTRUCCION CRITICA: Si la llamada menciona MULTIPLES razones de descalificación concurrentes, DEBES devolver TODAS las que apliquen hasta un máximo de 3. NO filtres. NO priorices. NO te limites a 2.\n\nEjemplo real:\nSi el propietario dice: "la propiedad está en intestamentario con mis hermanos, no tenemos escrituras todavía, y está en Tepatitlán Jalisco"\nOutput correcto: DESCALIFICACION: ["juridico", "sin_escrituras", "fuera_de_zona"]\nOutput INCORRECTO (solo 2): DESCALIFICACION: ["juridico", "fuera_de_zona"]\n\nDevolver siempre TODAS las categorías que el prospecto mencione, no solo las más severas.`;
  }

  return { systemPrompt: prompt, extractionPatterns: dbExtractionPatterns };
}

// ─── Call Anthropic API ────────────────────────────────────

export async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 120s timeout

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error: ${res.status} ${err}`);
    }

    const data = await res.json();
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error("Claude returned empty content");
    }
    return data.content[0].text;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Second call: tracker-based highlights ─────────────────

interface TrackerInput {
  code: string;
  label: string;
  icon: string;
  description: string;
  speaker: string;
}

interface AnalysisContext {
  score_general: number;
  clasificacion: string | null;
  patron_error: string | null;
  objecion_principal: string | null;
}

export interface HighlightResult {
  category_code: string;
  snippet: string;
  speaker: string;
  description: string;
}

export async function callClaudeForHighlights(
  transcription: string,
  trackers: TrackerInput[],
  ctx: AnalysisContext,
): Promise<HighlightResult[]> {
  if (trackers.length === 0) return [];

  const categoryList = trackers
    .map(t => `- ${t.code} (${t.icon} ${t.label}) — ${t.description}. Quien habla: ${t.speaker}`)
    .join("\n");

  const systemPrompt = `Eres un analista experto en conversaciones de ventas. Tu ÚNICA tarea es identificar fragmentos específicos que caigan en estas categorías.

CATEGORÍAS DISPONIBLES:

${categoryList}

Para cada categoría devuelve 0 a 3 highlights. Si no hay fragmento claro para una categoría, NO rellenes — omítela.

REGLAS ESTRICTAS:
1. snippet DEBE ser copiado LITERAL de la transcripción, sin parafrasear ni resumir
2. snippet entre 15 y 200 caracteres
3. speaker del fragmento debe coincidir con el speaker del tracker (si tracker dice "prospect", el snippet debe venir del prospecto)
4. Máximo 3 highlights por categoría
5. Total máximo 30 highlights (en la práctica aparecerán 8-15)

Formato JSON — SÓLO este JSON, sin prosa antes ni después:

{
  "highlights": [
    {
      "category_code": "motivacion",
      "snippet": "texto exacto copiado",
      "speaker": "prospect",
      "description": "máximo 15 palabras"
    }
  ]
}

Contexto del análisis (para elegir highlights que refuercen hallazgos):
Score: ${ctx.score_general}/100
Clasificación: ${ctx.clasificacion || "N/A"}
Área de mejora: ${ctx.patron_error || "N/A"}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: transcription }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[highlights] Claude API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const rawText = data?.content?.[0]?.text || "";

    // Try direct JSON.parse first
    let parsed: { highlights?: HighlightResult[] } | null = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Fallback: extract JSON object from markdown/backticks
      const jsonMatch = rawText.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* give up */ }
      }
    }

    if (!parsed?.highlights || !Array.isArray(parsed.highlights)) {
      console.warn("[highlights] Failed to parse highlights JSON");
      return [];
    }

    // Validate: only keep highlights with valid category_code
    const validCodes = new Set(trackers.map(t => t.code));
    return parsed.highlights
      .filter((h: HighlightResult) =>
        h && h.category_code && validCodes.has(h.category_code)
        && h.snippet && typeof h.snippet === "string" && h.snippet.length >= 10
      )
      .slice(0, 30);
  } catch (err) {
    console.warn(`[highlights] Error: ${err instanceof Error ? err.message : "unknown"}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
