import type { ParsedOutput, MatchedPhase, ScorecardPhase } from "./types.ts";

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

  // Score
  const scoreMatch = rawText.match(/SCORE GENERAL:\s*(\d+)/i);
  if (scoreMatch) result.score_general = parseInt(scoreMatch[1], 10);

  // Clasificacion
  const clasMatch = rawText.match(/Clasificaci[oó]n:\s*(excelente|buena|regular|deficiente)/i);
  if (clasMatch) {
    result.clasificacion = clasMatch[1].toLowerCase();
  } else if (result.score_general !== null) {
    if (result.score_general >= 85) result.clasificacion = "excelente";
    else if (result.score_general >= 65) result.clasificacion = "buena";
    else if (result.score_general >= 45) result.clasificacion = "regular";
    else result.clasificacion = "deficiente";
  }

  // Phases
  const phaseRegex = /([A-ZÁÉÍÓÚa-záéíóúñÑü][A-ZÁÉÍÓÚa-záéíóúñÑü ]{2,50}?)\s*\((\d+)\/(\d+)\)\s*:/g;
  let match;
  while ((match = phaseRegex.exec(rawText)) !== null) {
    result.phases.push({
      phase_name: match[1].trim(),
      score: parseInt(match[2], 10),
      score_max: parseInt(match[3], 10),
    });
  }

  // Patron error
  const patronMatch = rawText.match(/PATR[OÓ]N DE ERROR PRINCIPAL\s*\n+([\s\S]*?)(?:\n---|\n*$)/i);
  if (patronMatch) result.patron_error = patronMatch[1].trim();

  // Objecion principal
  const objecionMatch = rawText.match(/Objeci[oó]n(?:\s+principal)?:\s*(.+?)(?:\n|$)/i);
  if (objecionMatch) result.objecion_principal = objecionMatch[1].trim();

  // Siguiente accion
  const accionMatch = rawText.match(/(?:Acci[oó]n concreta|Siguiente acci[oó]n|Recomendaci[oó]n):\s*(.+?)(?:\n|$)/i);
  if (accionMatch) result.siguiente_accion = accionMatch[1].trim();

  // Momento critico
  const momentoMatch = rawText.match(/(?:MOMENTO DE QUIEBRE|MOMENTO CR[IÍ]TICO)\s*\n+([\s\S]*?)(?:\n---|\n*$)/i);
  if (momentoMatch) result.momento_critico = momentoMatch[1].trim();

  // Lead status
  const leadMatch = rawText.match(/Estado del lead:\s*(converted|lost_captadora|lost_external|pending)/i);
  if (leadMatch) result.lead_status = leadMatch[1].toLowerCase();

  // Prospect extraction — DB-driven or legacy
  if (Array.isArray(extractionPatterns) && extractionPatterns.length > 0) {
    for (const pat of extractionPatterns) {
      const re = new RegExp(`${pat.key}:\\s*(.+?)(?:\\n|$)`, "i");
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
    // Legacy hardcoded extraction
    const nameMatch = rawText.match(/PROSPECTO_NOMBRE:\s*(.+?)(?:\n|$)/i);
    if (nameMatch) result.prospect_name = nameMatch[1].trim();
    const zoneMatch = rawText.match(/PROSPECTO_ZONA:\s*(.+?)(?:\n|$)/i);
    if (zoneMatch) result.prospect_zone = zoneMatch[1].trim();
    const typeMatch = rawText.match(/TIPO_PROPIEDAD:\s*(.+?)(?:\n|$)/i);
    if (typeMatch) result.property_type = typeMatch[1].trim();
    const negocioMatch = rawText.match(/TIPO_NEGOCIO:\s*(.+?)(?:\n|$)/i);
    if (negocioMatch) result.business_type = negocioMatch[1].trim();
    const equipoMatch = rawText.match(/TIPO_EQUIPO:\s*(.+?)(?:\n|$)/i);
    if (equipoMatch) result.equipment_type = equipoMatch[1].trim();
    const reasonMatch = rawText.match(/MOTIVO_VENTA:\s*(.+?)(?:\n|$)/i);
    if (reasonMatch) result.sale_reason = reasonMatch[1].trim();
    const phoneMatch = rawText.match(/PROSPECTO_TELEFONO:\s*(.+?)(?:\n|$)/i);
    if (phoneMatch) {
      const digits = phoneMatch[1].replace(/\D/g, "");
      if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
    }
  }

  // Stage detection
  const stageMatch = rawText.match(/ETAPA_DETECTADA:\s*(.+?)(?:\n|$)/i);
  if (stageMatch) {
    const val = stageMatch[1].trim();
    if (val && !/^null$|^no\s/i.test(val)) result.detected_stage_name = val;
  }

  // Checklist
  const checklistMatch = rawText.match(/CHECKLIST:\s*(\[[\s\S]*?\])/i);
  if (checklistMatch) {
    try { result.checklist_results = JSON.parse(checklistMatch[1]); } catch { /* ignore */ }
  }

  // Descalification
  const descalMatch = rawText.match(/DESCALIFICACION:\s*(\[.*?\])/i);
  if (descalMatch) {
    try {
      const arr = JSON.parse(descalMatch[1]);
      if (Array.isArray(arr)) {
        result.descalificacion = arr.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3);
      }
    } catch { /* ignore */ }
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
      phase_id: match?.phase_id || null,
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
