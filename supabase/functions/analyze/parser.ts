import type { ParsedOutput, MatchedPhase, ScorecardPhase } from "./types.ts";

// Helper: builds regex fragment that tolerates markdown bold (**) around a keyword
// e.g. h("SCORE GENERAL") matches: SCORE GENERAL, **SCORE GENERAL**, **SCORE GENERAL**:, etc.
function h(keyword: string): string {
  return `\\*{0,2}\\s*${keyword}\\s*\\*{0,2}`;
}

// Same as h() but for "keyword:" patterns — colon can be inside or outside the bold
function hc(keyword: string): string {
  return `\\*{0,2}\\s*${keyword}\\s*:?\\s*\\*{0,2}\\s*:?\\s*`;
}

// ─── Parse Claude output ───────────────────────────────────

export function parseClaudeOutput(
  rawText: string,
  extractionPatterns: { key: string; regex: string; column: string }[] | null,
): ParsedOutput {
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
    descalificacion: [],
    prospect_name: null,
    prospect_zone: null,
    property_type: null,
    business_type: null,
    equipment_type: null,
    sale_reason: null,
    detected_stage_name: null,
    prospect_phone: null,
    checklist_results: null,
    highlights: [],
    phases: [],
  };

  // Score — tolerates **SCORE GENERAL:** 85
  const scoreMatch = rawText.match(new RegExp(`${hc("SCORE GENERAL")}(\\d+)`, "i"));
  if (scoreMatch) result.score_general = parseInt(scoreMatch[1], 10);

  // Clasificacion — tolerates **Clasificación:** excelente
  const clasMatch = rawText.match(new RegExp(`${hc("Clasificaci[oó]n")}(excelente|buena|regular|deficiente)`, "i"));
  if (clasMatch) {
    result.clasificacion = clasMatch[1].toLowerCase();
  } else if (result.score_general !== null) {
    if (result.score_general >= 85) result.clasificacion = "excelente";
    else if (result.score_general >= 65) result.clasificacion = "buena";
    else if (result.score_general >= 45) result.clasificacion = "regular";
    else result.clasificacion = "deficiente";
  }

  // Phases — case-insensitive, tolerates **Phase Name** (5/10):
  // F42: also tolerates spaces "(12 / 15)" and non-numeric scores like
  // "(No evaluado/15)" → score 0 (una fase no ejecutada ES un 0, no una fila ausente).
  // El max sigue siendo dígitos estrictos — es lo que ancla el patrón a una fase real.
  const phaseRegex = /\*{0,2}\s*([A-ZÁÉÍÓÚa-záéíóúñÑü][A-ZÁÉÍÓÚa-záéíóúñÑü ]{2,50}?)\s*\*{0,2}\s*\(\s*([^()\n]*?)\s*\/\s*(\d+)\s*\)\s*:?/gi;
  let match;
  while ((match = phaseRegex.exec(rawText)) !== null) {
    const scoreRaw = match[2].trim();
    result.phases.push({
      phase_name: match[1].trim(),
      score: /^\d+$/.test(scoreRaw) ? parseInt(scoreRaw, 10) : 0,
      score_max: parseInt(match[3], 10),
    });
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
  const sanitizeEnum = (raw: string) => raw.toLowerCase().replace(/[^a-záéíóú_]/g, "");
  const scanQuality = (text: string): string | null => {
    const m = text.match(/Calidad\s+del\s+lead\s*\*{0,2}\s*:\s*\*{0,2}\s*(\S+)/i);
    if (!m) return null;
    const val = sanitizeEnum(m[1]);
    return QUALITY_ENUM.includes(val) ? val : null;
  };
  const scanOutcome = (text: string): string | null => {
    const m = text.match(/Resultado\s+de\s+esta\s+conversaci[oó]n\s*\*{0,2}\s*:\s*\*{0,2}\s*(\S+)/i);
    if (!m) return null;
    const val = sanitizeEnum(m[1]);
    return OUTCOME_ENUM.includes(val) ? val : null;
  };
  const estadoBlock = rawText.match(/\n(?:-{3,}|\*{3,})\s*\n+#{0,4}\s*\*{0,2}\s*ESTADO\s+DEL\s+LEAD\s*\*{0,2}\s*\n+([\s\S]+?)(?:\n(?:-{3,}|\*{3,})|\n#{0,4}\s*\*{0,2}(?:SCORE|DIAGN|PATR[OÓ]N|MOMENTO|OBJECI|SIGUIENTE|ACCI[OÓ]N|DESCALIF|ETAPA|CHECKLIST|PROSPECTO)|\n*$)/i);
  if (estadoBlock) {
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

  // Prospect extraction — DB-driven or legacy
  if (Array.isArray(extractionPatterns) && extractionPatterns.length > 0) {
    for (const pat of extractionPatterns) {
      const re = new RegExp(`${hc(pat.key)}(.+?)(?:\\n|$)`, "i");
      const m = rawText.match(re);
      if (m) {
        const val = m[1].trim();
        if (pat.column === "prospect_phone") {
          const digits = val.replace(/\D/g, "");
          if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
        } else {
          (result as Record<string, unknown>)[pat.column] = val;
        }
      }
    }
  } else {
    // Legacy hardcoded extraction — tolerates **KEY:** value
    const nameMatch = rawText.match(new RegExp(`${hc("PROSPECTO_NOMBRE")}(.+?)(?:\\n|$)`, "i"));
    if (nameMatch) result.prospect_name = nameMatch[1].trim();
    const zoneMatch = rawText.match(new RegExp(`${hc("PROSPECTO_ZONA")}(.+?)(?:\\n|$)`, "i"));
    if (zoneMatch) result.prospect_zone = zoneMatch[1].trim();
    const typeMatch = rawText.match(new RegExp(`${hc("TIPO_PROPIEDAD")}(.+?)(?:\\n|$)`, "i"));
    if (typeMatch) result.property_type = typeMatch[1].trim();
    const negocioMatch = rawText.match(new RegExp(`${hc("TIPO_NEGOCIO")}(.+?)(?:\\n|$)`, "i"));
    if (negocioMatch) result.business_type = negocioMatch[1].trim();
    const equipoMatch = rawText.match(new RegExp(`${hc("TIPO_EQUIPO")}(.+?)(?:\\n|$)`, "i"));
    if (equipoMatch) result.equipment_type = equipoMatch[1].trim();
    const reasonMatch = rawText.match(new RegExp(`${hc("MOTIVO_VENTA")}(.+?)(?:\\n|$)`, "i"));
    if (reasonMatch) result.sale_reason = reasonMatch[1].trim();
    const phoneMatch = rawText.match(new RegExp(`${hc("PROSPECTO_TELEFONO")}(.+?)(?:\\n|$)`, "i"));
    if (phoneMatch) {
      const digits = phoneMatch[1].replace(/\D/g, "");
      if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
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
  const normalize = (s: string) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

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
