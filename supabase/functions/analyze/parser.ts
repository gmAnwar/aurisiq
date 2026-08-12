import type { DescarteScores, ParsedOutput, MatchedPhase, ScorecardPhase } from "./types.ts";

// Helper: builds regex fragment that tolerates markdown bold (**) around a keyword
// e.g. h("SCORE GENERAL") matches: SCORE GENERAL, **SCORE GENERAL**, **SCORE GENERAL**:, etc.
function h(keyword: string): string {
  return `\\*{0,2}\\s*${keyword}\\s*\\*{0,2}`;
}

// Same as h() but for "keyword:" patterns — colon can be inside or outside the bold
function hc(keyword: string): string {
  return `\\*{0,2}\\s*${keyword}\\s*:?\\s*\\*{0,2}\\s*:?\\s*`;
}

// Fuente única de la capa de persistencia: las columns de extraction_patterns
// que el pipeline REALMENTE escribe — intersección ParsedOutput ∩
// buildAnalysisUpdatePayload (el guard de la suite verifica ambos lados en
// runtime, sin listas espejo). Una column declarada fuera de este set se
// ignora en el data path y se reporta como config inválida
// (extraction_config_invalid) — NUNCA como miss F47: el problema es la
// config del scorecard, no el output del modelo.
export const EXTRACTION_WRITABLE_COLUMNS: ReadonlySet<string> = new Set([
  "prospect_name",
  "prospect_zone",
  "property_type",
  "business_type",
  "equipment_type",
  "sale_reason",
  "prospect_phone",
  "vehicle_interest",
  "financing_type",
]);

// ─── Parse Claude output ───────────────────────────────────

export function parseClaudeOutput(
  rawText: string,
  extractionPatterns: { key: string; regex: string; column: string }[] | null,
): ParsedOutput {
  // F42d: el modelo a veces emite su output con la puntuación markdown escapada
  // ("cerrado\_parcial", "PROSPECTO\_NOMBRE:", separadores "\-\-\-"), lo que
  // rompe labels y enums con underscore y el aislamiento de bloques. Des-escape
  // global sobre la copia local ANTES de cualquier match:
  // (a) la clase EXCLUYE " \ / y letras — los escapes legales de JSON (\" \\ \/
  //     \b \f \n \r \t \uXXXX). Preservarlos impide corromper CHECKLIST y
  //     DESCALIFICACION: dentro de JSON, \_ \- etc. ya son ilegales hoy, así
  //     que quitar el backslash repara en vez de corromper.
  // (b) monotónico: solo crea matches donde hoy no hay ninguno.
  // (c) forensia F46: index.ts pasa su rawOutput ORIGINAL a buildParserDebug,
  //     así que raw_output_capture queda sin des-escapar; raw_estado_block sí
  //     sale normalizado — aceptable y documentado.
  const MD_ESCAPE_RE = /\\([_*[\]()#+\-.!~>|`])/g;
  const mdEscapeCount = (rawText.match(MD_ESCAPE_RE) || []).length;
  if (mdEscapeCount > 0) {
    // Señal de "modo escape" del modelo en logs — solo el conteo, cero PII.
    console.warn(`[parser] F42d: ${mdEscapeCount} escapes markdown des-escapados`);
  }
  rawText = rawText.replace(MD_ESCAPE_RE, "$1");

  const result: ParsedOutput = {
    score_general: null,
    clasificacion: null,
    momento_critico: null,
    patron_error: null,
    objecion_principal: null,
    siguiente_accion: null,
    lead_status: null,
    lead_quality: null,
    lead_outcome: null,
    raw_estado_block: null,
    // F47: null = "no se pudo leer un array válido" (keyword ausente o JSON
    // roto). [] solo si se parseó — el caller normaliza null→[] cuando el
    // prompt ni pidió el bloque (normalizeDescal).
    descalificacion: null,
    // F48b: se llena abajo con parseDescarteBlock (bloque ausente → null).
    descarte: null,
    prospect_name: null,
    prospect_zone: null,
    property_type: null,
    business_type: null,
    equipment_type: null,
    vehicle_interest: null,
    financing_type: null,
    sale_reason: null,
    detected_stage_name: null,
    prospect_phone: null,
    checklist_results: null,
    highlights: [],
    phases: [],
    extraction_label_misses: [],
    unsupported_extraction_columns: [],
  };

  // Score — tolerates **SCORE GENERAL:** 85
  const scoreMatch = rawText.match(new RegExp(`${hc("SCORE GENERAL")}(\\d+)`, "i"));
  if (scoreMatch) result.score_general = parseInt(scoreMatch[1], 10);

  // Clasificacion — tolerates **Clasificación:** excelente
  const clasMatch = rawText.match(new RegExp(`${hc("Clasificaci[oó]n")}(excelente|buena|regular|deficiente)`, "i"));
  if (clasMatch) {
    result.clasificacion = clasMatch[1].toLowerCase();
  } else if (result.score_general !== null) {
    result.clasificacion = deriveClasificacion(result.score_general);
  }

  // Phases — case-insensitive, tolerates **Phase Name** (5/10):
  // F42: also tolerates spaces "(12 / 15)" and non-numeric scores like
  // "(No evaluado/15)" → score 0 (una fase no ejecutada ES un 0, no una fila ausente).
  // El max sigue siendo dígitos estrictos — es lo que ancla el patrón a una fase real.
  // HOTFIX F48b, capa 1 de 2 — EXCISIÓN: el bloque EVALUACION DE DESCARTE se
  // corta ANTES de buscar fases, porque sus criterios en formato "Nombre (5/5)"
  // matchean el phaseRegex y terminaban como filas de analysis_phases. El resto
  // de los regex de esta función siguen leyendo `rawText` sin cambio.
  const phasesText = stripDescarteBlock(rawText);
  const phaseRegex = /\*{0,2}\s*([A-ZÁÉÍÓÚa-záéíóúñÑü][A-ZÁÉÍÓÚa-záéíóúñÑü ]{2,50}?)\s*\*{0,2}\s*\(\s*([^()\n]*?)\s*\/\s*(\d+)\s*\)\s*:?/gi;
  let match;
  while ((match = phaseRegex.exec(phasesText)) !== null) {
    const scoreRaw = match[2].trim();
    const isNumericScore = /^\d+$/.test(scoreRaw);
    if (!isNumericScore) {
      // F42: sin este warn no se distingue un 0 genuino del LLM de un texto
      // no numérico que mapeamos a 0.
      console.warn(`[parser] non-numeric phase score mapped to 0: ${scoreRaw || "(vacío)"}`);
    }
    result.phases.push({
      phase_name: match[1].trim(),
      score: isNumericScore ? parseInt(scoreRaw, 10) : 0,
      score_max: parseInt(match[3], 10),
    });
  }

  // HOTFIX F48b, capa 2 de 2 — FILTRO POR NOMBRE: cubre el caso que la excisión
  // no alcanza, cuando el modelo escribe los criterios FUERA del bloque (p. ej.
  // dentro del DIAGNÓSTICO POR FASE). Se filtra la CLASE (los 4 criterios), no
  // un carácter concreto — regla S52.
  const nombresDescarte = new Set(DESCARTE_CRITERIO_NAMES.map(normalizePhaseName));
  const antesDelFiltro = result.phases.length;
  result.phases = result.phases.filter((p) => !nombresDescarte.has(normalizePhaseName(p.phase_name)));
  if (result.phases.length !== antesDelFiltro) {
    // Señal de que el modelo desobedeció el prompt: solo el conteo, cero PII.
    console.warn(`[parser] F48b: ${antesDelFiltro - result.phases.length} criterios de descarte descartados como fase`);
  }

  // Patron error — tolerates **PATRÓN DE ERROR PRINCIPAL**\n or **PATRÓN DE ERROR PRINCIPAL:**\n
  const patronMatch = rawText.match(new RegExp(`${h("PATR[OÓ]N DE ERROR PRINCIPAL")}\\s*:?\\s*\\n+([\\s\\S]*?)(?:\\n---|\\n*$)`, "i"));
  if (patronMatch) result.patron_error = patronMatch[1].trim();

  // Objecion principal — MUST be a top-level block (preceded by --- or start of section)
  // Matches: "---\nOBJECIONES DETECTADAS\n...\nObjeción: content"
  // Does NOT match: "Manejo de Objeciones (25/35):" inside phase diagnostics
  const objecionMatch = rawText.match(
    /\n---\n+\*{0,2}\s*OBJECIONES?\s*(?:DETECTADAS?)?\s*\*{0,2}\s*\n+([\s\S]+?)(?:\n---|\n\*{0,2}(?:SIGUIENTE|PATR[OÓ]N|MOMENTO|SCORE|ACCI[OÓ]N|DESCALIF|ETAPA|CHECKLIST|PROSPECTO))/i
  );
  if (objecionMatch) {
    // Extract the actual objection text — may contain "Objeción: X" sub-headers
    const block = objecionMatch[1].trim();
    // If block has "Objeción:" sub-header, extract just the content after it
    const subMatch = block.match(/Objeci[oó]n(?:\s+principal)?:\s*([\s\S]+)/i);
    result.objecion_principal = subMatch ? subMatch[1].trim() : block;
  }

  // Siguiente accion — MUST be a top-level block (preceded by ---)
  const accionMatch = rawText.match(
    /\n---\n+\*{0,2}\s*(?:SIGUIENTE\s+PASO|ACCI[OÓ]N\s+CONCRETA|SIGUIENTE\s+ACCI[OÓ]N|RECOMENDACI[OÓ]N)[^\n]*\s*\*{0,2}\s*\n+([\s\S]+?)(?:\n---|\n\*{0,2}(?:OBJECION|PATR[OÓ]N|MOMENTO|SCORE|DESCALIF|ETAPA|CHECKLIST|PROSPECTO))/i
  );
  if (accionMatch) {
    const block = accionMatch[1].trim();
    // If block has "Acción concreta:" or "Siguiente acción:" sub-header, extract content
    const subMatch = block.match(/(?:Acci[oó]n\s+concreta[^:]*|Siguiente\s+acci[oó]n|Recomendaci[oó]n):\s*([\s\S]+)/i);
    result.siguiente_accion = subMatch ? subMatch[1].trim() : block;
  }

  // Momento critico — supports "HEADER\ntext", "HEADER: text", "**HEADER**\ntext"
  const momentoMatch = rawText.match(new RegExp(`${h("(?:MOMENTO DE QUIEBRE|MOMENTO CR[IÍ]TICO)")}\\s*:?\\s*(?:\\n+|:\\s*)([\\s\\S]*?)(?:\\n\\n|\\n---|\\n\\*{0,2}[A-Z]|$)`, "i"));
  if (momentoMatch) result.momento_critico = momentoMatch[1].trim();

  // Lead status — tolerates **Estado del lead:** pending
  const leadMatch = rawText.match(new RegExp(`${hc("Estado del lead")}(converted|lost_captadora|lost_external|pending)`, "i"));
  if (leadMatch) result.lead_status = leadMatch[1].toLowerCase();

  // Lead quality + outcome — top-level block "ESTADO DEL LEAD" between separators.
  // F42 hardening: tolerates *** separators, markdown # headers, and end-of-string
  // (funciona como último bloque del output — el terminador original no tenía $).
  const QUALITY_ENUM = ["calificado", "descalificado", "indeterminado"];
  const OUTCOME_ENUM = ["cerrado_completo", "cerrado_parcial", "pospuesto_con_agenda", "pospuesto_sin_agenda", "descalificado", "perdido"];
  // F42 fix final: normalizar ANTES de validar y matchear el enum al INICIO del
  // valor sobre la línea completa — tolera "Calificado", "CALIFICADO",
  // "calificado — pendiente confirmar saldo" y "cerrado completo" (espacio en
  // vez de underscore). NUNCA acepta un valor que no empiece con un enum válido.
  const matchEnumStart = (raw: string, allowed: string[]): string | null => {
    const val = raw.toLowerCase().trim()
      .replace(/^[^a-záéíóúñ]+/, "") // markdown/bold/puntuación antes del valor
      .replace(/\s+/g, "_");         // "cerrado completo" → "cerrado_completo"
    return [...allowed].sort((a, b) => b.length - a.length).find((e) => val.startsWith(e)) ?? null;
  };
  // F42b: el valor de calidad suele venir envuelto en prosa — startsWith lo
  // rechazaba. Match por token con word-boundary, longest-first (descalificado
  // antes que calificado, evita el substring trap) + guarda de negación.
  const matchQualityEnum = (raw: string): string | null => {
    const val = raw.toLowerCase();
    for (const e of [...QUALITY_ENUM].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(^|[^a-záéíóúñ])${e}([^a-záéíóúñ]|$)`, "i");
      if (re.test(val)) {
        const before = val.slice(0, val.indexOf(e)).trim();
        if (e === "calificado" && /\b(no|aun no|aún no|sin)\s*$/.test(before)) return "indeterminado";
        return e;
      }
    }
    return null;
  };
  const scanQuality = (text: string): string | null => {
    // F42c: el TONE_BLOCK prohíbe "lead" (anglicismo → "prospecto") y el modelo
    // aplica esa regla al LABEL del template → emite "Calidad del prospecto:".
    // Cubrir ambos sustantivos. matchQualityEnum ya reconocía los 3 valores.
    const m = text.match(/Calidad\s+(?:del?\s+(?:lead|prospecto))?\s*\*{0,2}\s*:\s*([^\n]+)/i)
          || text.match(/Calidad\s*\*{0,2}\s*:\s*([^\n]+)/i);
    return m ? matchQualityEnum(m[1]) : null;
  };
  const scanOutcome = (text: string): string | null => {
    const m = text.match(/Resultado\s+de\s+esta\s+conversaci[oó]n\s*\*{0,2}\s*:\s*([^\n]+)/i);
    return m ? matchEnumStart(m[1], OUTCOME_ENUM) : null;
  };
  const estadoBlock = rawText.match(/\n(?:-{3,}|\*{3,})\s*\n+#{0,4}\s*\*{0,2}\s*ESTADO\s+DEL\s+LEAD\s*\*{0,2}\s*\n+([\s\S]+?)(?:\n(?:-{3,}|\*{3,})|\n#{0,4}\s*\*{0,2}(?:SCORE|DIAGN|PATR[OÓ]N|MOMENTO|OBJECI|SIGUIENTE|ACCI[OÓ]N|DESCALIF|ETAPA|CHECKLIST|PROSPECTO)|\n*$)/i);
  if (estadoBlock) {
    // F46: preservar el bloque crudo para diagnóstico de partial_extraction.
    // Solo se persiste (tabla analysis_parser_debug) cuando el detector F42 dispara.
    result.raw_estado_block = estadoBlock[1];
    result.lead_quality = scanQuality(estadoBlock[1]);
    result.lead_outcome = scanOutcome(estadoBlock[1]);
  }
  // F42 desambiguación: si el LLM fusionó los bloques casi homónimos ("Estado del
  // lead:" dentro de SIGUIENTE PASO vs header "ESTADO DEL LEAD"), el header no
  // existe pero las líneas-label sí — extraer por label global. Los labels
  // "Calidad del lead"/"Resultado de esta conversación" son únicos en el output
  // y los valores se validan contra enum, así que el scan global es seguro.
  if (result.lead_quality === null) result.lead_quality = scanQuality(rawText);
  if (result.lead_outcome === null) result.lead_outcome = scanOutcome(rawText);

  // Prospect extraction — DB-driven (extraction_patterns del scorecard) o
  // legacy hardcodeada: misma mecánica de match, solo cambia la fuente de
  // patterns. `pat.regex` del JSONB NO se usa — el regex se construye desde
  // pat.key (verificado: ningún consumidor lo lee).
  // F47: label-hit tracking — si el LABEL no matchea se registra el miss SIN
  // mirar jamás el valor: "PROSPECTO_TELEFONO: No detectado" es label presente
  // (hit) aunque prospect_phone quede null por el gate de dígitos.
  const LEGACY_EXTRACTION_PATTERNS: { key: string; column: string }[] = [
    { key: "PROSPECTO_NOMBRE", column: "prospect_name" },
    { key: "PROSPECTO_ZONA", column: "prospect_zone" },
    { key: "TIPO_PROPIEDAD", column: "property_type" },
    { key: "TIPO_NEGOCIO", column: "business_type" },
    { key: "TIPO_EQUIPO", column: "equipment_type" },
    { key: "MOTIVO_VENTA", column: "sale_reason" },
    { key: "PROSPECTO_TELEFONO", column: "prospect_phone" },
  ];
  const activePatterns: { key: string; column: string }[] =
    Array.isArray(extractionPatterns) && extractionPatterns.length > 0
      ? extractionPatterns
      : LEGACY_EXTRACTION_PATTERNS;
  for (const pat of activePatterns) {
    if (!EXTRACTION_WRITABLE_COLUMNS.has(pat.column)) {
      // Config inválida del scorecard: destino no persistible — fuera del
      // data path y jamás como miss F47 (el caller alerta
      // extraction_config_invalid con dedupe por scorecard).
      result.unsupported_extraction_columns.push(pat.column);
      continue;
    }
    const re = new RegExp(`${hc(pat.key)}(.+?)(?:\\n|$)`, "i");
    const m = rawText.match(re);
    if (!m) {
      result.extraction_label_misses.push({ key: pat.key, column: pat.column });
      continue;
    }
    const val = m[1].trim();
    if (pat.column === "prospect_phone") {
      const digits = val.replace(/\D/g, "");
      if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
    } else {
      (result as Record<string, unknown>)[pat.column] = val;
    }
  }

  // Stage detection — tolerates **ETAPA_DETECTADA:** value
  const stageMatch = rawText.match(new RegExp(`${hc("ETAPA_DETECTADA")}(.+?)(?:\\n|$)`, "i"));
  if (stageMatch) {
    const val = stageMatch[1].trim();
    if (val && !/^null$|^no\s/i.test(val)) result.detected_stage_name = val;
  }

  // Checklist — tolerates **CHECKLIST:** [...]
  const checklistMatch = rawText.match(new RegExp(`${hc("CHECKLIST")}(\\[[\\s\\S]*?\\])`, "i"));
  if (checklistMatch) {
    try { result.checklist_results = JSON.parse(checklistMatch[1]); } catch { /* ignore */ }
  }

  // Descalification — multiline-safe, tolerates **DESCALIFICACION:** [...]
  const descalMatch = rawText.match(new RegExp(`${hc("DESCALIFICACION")}(\\[[\\s\\S]*?\\])`, "i"));
  if (descalMatch) {
    try {
      const arr = JSON.parse(descalMatch[1]);
      if (Array.isArray(arr)) {
        result.descalificacion = arr.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3);
      }
    } catch (e) {
      console.warn(`[parser] DESCALIFICACION JSON.parse failed: ${(e as Error).message} | raw=${descalMatch[1].slice(0, 200)}`);
    }
  } else if (/DESCALIFICACION/i.test(rawText)) {
    console.warn(`[parser] DESCALIFICACION keyword found in output but regex failed to extract array`);
  }

  // F48b: bloque EVALUACION DE DESCARTE. Se lee sobre `rawText`, que a esta
  // altura YA pasó por el des-escape global F42d — por eso parseDescarteBlock
  // no lleva tolerancia propia a "\_" ni "\-".
  result.descarte = parseDescarteBlock(rawText);

  // Highlights: parsed in dedicated second Claude call, not from main output

  // Clean text fields
  const cleanField = (t: string | null): string | null => {
    if (!t) return t;
    let s = t;
    const idx = s.indexOf("```");
    if (idx > 0) s = s.slice(0, idx);
    s = s.replace(/\n\s*\{\s*"[\s\S]*$/g, "");
    s = s.replace(/\s*json\s*\{[\s\S]*$/gi, "");
    s = s.replace(/^\*+\s*/, "");
    return s.trim() || null;
  };
  result.patron_error = cleanField(result.patron_error);
  result.momento_critico = cleanField(result.momento_critico);
  result.objecion_principal = cleanField(result.objecion_principal);
  result.siguiente_accion = cleanField(result.siguiente_accion);

  return result;
}

// ─── F48b: bloque EVALUACION DE DESCARTE ───────────────────

// Los 4 criterios en el orden del prompt. FUENTE ÚNICA de sus nombres: de aquí
// salen tanto el regex de lectura como la lista que filtra fases basura, así
// que renombrar un criterio no puede dejar una de las dos desincronizada.
export const DESCARTE_CRITERIOS: { key: keyof DescarteScores; name: string }[] = [
  { key: "causal_confirmada", name: "Causal confirmada" },
  { key: "resolubilidad_explorada", name: "Resolubilidad explorada" },
  { key: "orientacion_correcta", name: "Orientación correcta" },
  { key: "puerta_abierta", name: "Puerta abierta" },
];

/** Nombres de los criterios — los que NUNCA pueden entrar a analysis_phases. */
export const DESCARTE_CRITERIO_NAMES: string[] = DESCARTE_CRITERIOS.map((c) => c.name);

// El prompt pide los labels SIN acento ("Orientacion") pero el modelo escribe
// la forma natural ("Orientación"), así que cada vocal admite ambas. Derivado
// del nombre canónico — no es una segunda copia del string.
function accentTolerant(literal: string): string {
  const PARES: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
  return literal.replace(/[aeiouáéíóú]/gi, (c) => {
    const base = c.toLowerCase().normalize("NFD")[0];
    return PARES[base] ? `[${base}${PARES[base]}]` : c;
  });
}

/** Normalización compartida de nombres de fase: minúsculas, sin acentos, espacios colapsados. */
export function normalizePhaseName(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Ubica el segmento del bloque EVALUACION DE DESCARTE: del heading al siguiente
 * separador de bloque (o al final). null si el bloque no está.
 * Anclaje único — lo comparten la lectura del bloque y su excisión.
 */
function findDescarteSegment(rawText: string): { start: number; end: number } | null {
  // Word-boundary en ambos extremos: "PREEVALUACION DE DESCARTE" o
  // "EVALUACION DE DESCARTES" no cuentan como el bloque.
  const heading = rawText.match(/\bEVALUACI[OÓ]N DE DESCARTE\b/i);
  if (!heading) return null;
  const start = heading.index!;
  const afterHeading = start + heading[0].length;
  const sep = rawText.slice(afterHeading).search(/\n---/);
  return { start, end: sep === -1 ? rawText.length : afterHeading + sep };
}

/**
 * El texto SIN el bloque de descarte. Solo alimenta al parsing de FASES.
 *
 * HOTFIX F48b: el modelo emite los criterios también en formato de fase
 * ("Causal confirmada (5/5): ..."), y el phaseRegex los matchea → matchPhaseIds
 * les inventa phase_id vía slugify → writeAnalysisPhases los persiste. En el
 * smoke de Bodygreen (dbb5db83) eso metió 4 filas basura en analysis_phases,
 * que contaminan fase-más-débil y current_focus_phase (misma familia que las 26
 * huérfanas de F48a) y, de paso, inflaron el conteo a 7 y taparon el
 * phases_mismatch que debían disparar las 2 fases reales ausentes.
 */
export function stripDescarteBlock(rawText: string): string {
  const seg = findDescarteSegment(rawText);
  return seg === null ? rawText : rawText.slice(0, seg.start) + rawText.slice(seg.end);
}

/**
 * Aísla el bloque EVALUACION DE DESCARTE y lee sus 4 criterios.
 *
 * Devuelve null si el bloque está ausente O si falta cualquiera de las 4
 * líneas: un descarte parcial NO se rellena con ceros — un cero inventado se
 * lee como "la captadora no lo hizo", que es justo la difamación que este
 * score existe para evitar. El caller convierte ese null en el trigger
 * descarte_block_missing y deja score_desempeno en NULL.
 *
 * Precondición: `rawText` ya pasó por el des-escape global F42d.
 */
export function parseDescarteBlock(rawText: string): DescarteScores | null {
  // Lee del texto COMPLETO: la excisión de stripDescarteBlock solo afecta al
  // parsing de fases, nunca a la lectura del bloque.
  const seg = findDescarteSegment(rawText);
  if (!seg) return null;
  const block = rawText.slice(seg.start, seg.end);

  const out = {} as DescarteScores;
  for (const { key, name } of DESCARTE_CRITERIOS) {
    const label = accentTolerant(name);
    // Label + N/5. hc() (no h()) porque el modelo pone el ":" DENTRO de la
    // negrita: "**Causal confirmada:** 5/5". El "/5" es obligatorio: fija el
    // formato y evita comerse un número suelto de otra línea.
    const m = block.match(new RegExp(`${hc(label)}(\\d+)\\s*/\\s*5`, "i"));
    if (!m) return null; // parcial = null, no inventar ceros
    out[key] = Math.min(Math.max(parseInt(m[1], 10), 0), 5);
  }
  return out;
}

// ─── Match parsed phase names to scorecard phase IDs ───────

// Generate deterministic slug from phase name (fallback when no phase_id match)
function slugify(name: string): string {
  return (name || "unknown")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "phase";
}

export function matchPhaseIds(
  parsedPhases: ParsedOutput["phases"],
  scorecardPhases: ScorecardPhase[],
): MatchedPhase[] {
  // F48b: normalizePhaseName es el MISMO normalize que filtra los criterios de
  // descarte \u2014 una sola definici\u00f3n para las dos decisiones.
  const normalize = normalizePhaseName;

  return parsedPhases.map((parsed, idx) => {
    const normalizedParsed = normalize(parsed.phase_name);
    const match = scorecardPhases.find(sp => sp.phase_name && normalize(sp.phase_name) === normalizedParsed);
    return {
      phase_id: match?.phase_id || slugify(parsed.phase_name),
      phase_name: parsed.phase_name,
      score: parsed.score,
      score_max: parsed.score_max,
    };
  });
}

// ─── F44: score_general derivado de la suma de fases ───────

// Umbrales canónicos de clasificación. El CHECK de analyses.clasificacion
// (migración 001) solo restringe los VALORES; los cortes numéricos viven aquí.
export function deriveClasificacion(score: number): string {
  if (score >= 85) return "excelente";
  if (score >= 65) return "buena";
  if (score >= 45) return "regular";
  return "deficiente";
}

// La aritmética del LLM deriva (66% de análisis V5A con delta, hasta +22).
// Los score_max de cada scorecard suman 100 → score_general ES la suma de fases.
// Solo sobrescribe con extracción COMPLETA (count exacto + phase_ids únicos);
// extracción parcial → conserva el valor del LLM, no inventa.
export function deriveScoreFromPhases(
  llmScore: number | null,
  llmClasificacion: string | null,
  phases: { phase_id: string; score: number; score_max: number }[],
  expectedCount: number,
): { score: number | null; clasificacion: string | null; phaseSum: number | null; overridden: boolean } {
  const uniqueIds = new Set(phases.map((p) => p.phase_id));
  const complete = expectedCount > 0 && phases.length === expectedCount && uniqueIds.size === phases.length;
  if (!complete || llmScore === null) {
    return { score: llmScore, clasificacion: llmClasificacion, phaseSum: null, overridden: false };
  }
  // Suma de scores CLAMPEADOS — los mismos valores que quedan en analysis_phases
  const phaseSum = phases.reduce((acc, p) => acc + Math.min(p.score, p.score_max), 0);
  const corrected = Math.min(phaseSum, 100);
  if (corrected === llmScore) {
    return { score: llmScore, clasificacion: llmClasificacion, phaseSum, overridden: false };
  }
  return { score: corrected, clasificacion: deriveClasificacion(corrected), phaseSum, overridden: true };
}

// ─── Conversion discrepancy detection ──────────────────────

export function detectConversionDiscrepancy(
  claudeLeadStatus: string | null,
  userAvanzo: string,
): boolean {
  if (!claudeLeadStatus) return false;
  if (userAvanzo === "converted" && claudeLeadStatus !== "converted") return true;
  if (userAvanzo === "lost_captadora" && claudeLeadStatus === "converted") return true;
  return false;
}
