// AurisIQ Worker v1.3.0 — Cola async + status + timeout + Stripe webhooks
// Separado de Optix. CORS restringido a app.aurisiq.io.

const ALLOWED_ORIGINS = [
  'https://app.aurisiq.io',
  'http://localhost:3000',
  'http://localhost:5173',
];

const TIER_LIMITS = {
  starter: 50,
  growth: 200,
  pro: 500,
  scale: 1500,
  enterprise: null,
  founder: 50,
};

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const STALE_JOB_MINUTES = 5;
const ASSEMBLYAI_URL = 'https://api.assemblyai.com/v2';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB

// ─── Helpers ───────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ─── Supabase client ───────────────────────────────────────

async function supabaseRpc(env, fnName, params) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`RPC ${fnName} failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function supabaseInsert(env, table, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`INSERT ${table} failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function supabaseUpdate(env, table, matchCol, matchVal, data) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?${matchCol}=eq.${matchVal}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`UPDATE ${table} failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function supabaseSelect(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SELECT ${table} failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function getScorecard(env, scorecardId) {
  const rows = await supabaseSelect(
    env,
    'scorecards',
    `id=eq.${scorecardId}&select=prompt_template,phases,name,version,vertical,structure,template_id`
  );
  if (!rows.length) throw new Error(`Scorecard ${scorecardId} not found`);
  return rows[0];
}

async function getDescalCategories(env, orgId) {
  return supabaseSelect(
    env,
    'descalification_categories',
    `organization_id=eq.${orgId}&select=code,label&order=code`
  );
}

async function getOrgPlan(env, orgId) {
  const rows = await supabaseSelect(
    env,
    'organizations',
    `id=eq.${orgId}&select=plan,access_status`
  );
  if (!rows.length) throw new Error(`Organization ${orgId} not found`);
  return rows[0];
}

// ─── Edit percentage (server-side, never trust frontend) ──

function computeEditPct(original, edited) {
  if (!original || !edited) return 0;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const a = norm(original).split(/\s+/).filter(Boolean);
  const b = norm(edited).split(/\s+/).filter(Boolean);
  if (a.length === 0 || a.join(' ') === b.join(' ')) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const changed = Math.max(m, n) - prev[n];
  return Math.min(100, Math.round((changed / m) * 100));
}

// ─── Claude API ────────────────────────────────────────────

async function callClaude(env, systemPrompt, userMessage) {
  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  if (!data.content || !data.content[0] || !data.content[0].text) {
    throw new Error('Claude returned empty content');
  }
  return data.content[0].text;
}

// ─── Parsing ───────────────────────────────────────────────

function parseClaudeOutput(rawText, extractionPatterns) {
  const result = {
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

  const scoreMatch = rawText.match(/SCORE GENERAL:\s*(\d+)/i);
  if (scoreMatch) result.score_general = parseInt(scoreMatch[1], 10);

  const clasMatch = rawText.match(
    /Clasificaci[oó]n:\s*(excelente|buena|regular|deficiente)/i
  );
  if (clasMatch) {
    result.clasificacion = clasMatch[1].toLowerCase();
  } else if (result.score_general !== null) {
    // Fallback: derive from score when Claude uses non-standard labels
    if (result.score_general >= 85) result.clasificacion = 'excelente';
    else if (result.score_general >= 65) result.clasificacion = 'buena';
    else if (result.score_general >= 45) result.clasificacion = 'regular';
    else result.clasificacion = 'deficiente';
  }

  // Phases — space only in name (no newlines)
  const phaseRegex =
    /([A-ZÁÉÍÓÚa-záéíóúñÑü][A-ZÁÉÍÓÚa-záéíóúñÑü ]{2,50}?)\s*\((\d+)\/(\d+)\)\s*:/g;
  let match;
  while ((match = phaseRegex.exec(rawText)) !== null) {
    result.phases.push({
      phase_name: match[1].trim(),
      score: parseInt(match[2], 10),
      score_max: parseInt(match[3], 10),
    });
  }

  const patronMatch = rawText.match(
    /PATR[OÓ]N DE ERROR PRINCIPAL\s*\n+([\s\S]*?)(?:\n---|\n*$)/i
  );
  if (patronMatch) result.patron_error = patronMatch[1].trim();

  const objecionMatch = rawText.match(/Objeci[oó]n(?:\s+principal)?:\s*(.+?)(?:\n|$)/i);
  if (objecionMatch) result.objecion_principal = objecionMatch[1].trim();

  const accionMatch = rawText.match(/(?:Acci[oó]n concreta|Siguiente acci[oó]n|Recomendaci[oó]n):\s*(.+?)(?:\n|$)/i);
  if (accionMatch) result.siguiente_accion = accionMatch[1].trim();

  const momentoMatch = rawText.match(
    /(?:MOMENTO DE QUIEBRE|MOMENTO CR[IÍ]TICO)\s*\n+([\s\S]*?)(?:\n---|\n*$)/i
  );
  if (momentoMatch) result.momento_critico = momentoMatch[1].trim();

  const leadMatch = rawText.match(
    /Estado del lead:\s*(converted|lost_captadora|lost_external|pending)/i
  );
  if (leadMatch) result.lead_status = leadMatch[1].toLowerCase();

  // Prospect extraction — DB-driven or legacy fallback
  if (Array.isArray(extractionPatterns) && extractionPatterns.length > 0) {
    // DB-driven: use extraction_patterns from scorecard_templates.structure
    for (const pat of extractionPatterns) {
      const re = new RegExp(`${pat.key}:\\s*(.+?)(?:\\n|$)`, 'i');
      const m = rawText.match(re);
      if (m) {
        const val = m[1].trim();
        if (pat.column === 'prospect_phone') {
          // Phone: extract last 10 digits
          const digits = val.replace(/\D/g, '');
          if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
        } else {
          result[pat.column] = val;
        }
      }
    }
  } else {
    // Legacy hardcoded extraction (remove after 2026-05-12)
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
      const digits = phoneMatch[1].replace(/\D/g, '');
      if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
    }
  }
  // Stage detection — always runs (not vertical-specific)
  const stageMatch = rawText.match(/ETAPA_DETECTADA:\s*(.+?)(?:\n|$)/i);
  if (stageMatch) {
    const val = stageMatch[1].trim();
    if (val && !/^null$|^no\s/i.test(val)) result.detected_stage_name = val;
  }

  // Checklist
  const checklistMatch = rawText.match(/CHECKLIST:\s*(\[[\s\S]*?\])/i);
  if (checklistMatch) {
    try {
      result.checklist_results = JSON.parse(checklistMatch[1]);
    } catch { /* ignore */ }
  }

  // Descalification — parse JSON array from Claude output
  const descalMatch = rawText.match(/DESCALIFICACION:\s*(\[.*?\])/i);
  console.log(`[debug-descal-parse] match=${!!descalMatch} raw=${descalMatch ? descalMatch[1] : 'null'}`);
  if (descalMatch) {
    try {
      const arr = JSON.parse(descalMatch[1]);
      console.log(`[debug-descal-parse] parsed=${JSON.stringify(arr)}`);
      if (Array.isArray(arr)) result.descalificacion = arr.map(s => String(s).trim()).filter(Boolean).slice(0, 3);
    } catch (e) {
      console.error(`[debug-descal-parse] JSON.parse failed: ${e.message} raw=${descalMatch[1]}`);
    }
  }

  // Highlights — snippet-based anchors from Claude
  const highlightsMatch = rawText.match(/HIGHLIGHTS:\s*(\[[\s\S]*?\])/i);
  if (highlightsMatch) {
    try {
      const arr = JSON.parse(highlightsMatch[1]);
      if (Array.isArray(arr)) {
        result.highlights = arr
          .filter(h => h && h.type && h.snippet && typeof h.snippet === 'string')
          .slice(0, 6);
      }
    } catch { /* malformed JSON — degrade silently */ }
  }

  // Strip JSON artifacts from all text fields
  const cleanField = (t) => {
    if (!t) return t;
    let s = t;
    const idx = s.indexOf('```');
    if (idx > 0) s = s.slice(0, idx);
    s = s.replace(/\n\s*\{\s*"[\s\S]*$/g, '');
    s = s.replace(/\s*json\s*\{[\s\S]*$/gi, '');
    s = s.replace(/^\*+\s*/, '');
    return s.trim() || null;
  };
  result.patron_error = cleanField(result.patron_error);
  result.momento_critico = cleanField(result.momento_critico);
  result.objecion_principal = cleanField(result.objecion_principal);
  result.siguiente_accion = cleanField(result.siguiente_accion);

  return result;
}

function matchPhaseIds(parsedPhases, scorecardPhases) {
  const normalize = (s) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  return parsedPhases.map((parsed, idx) => {
    const normalizedParsed = normalize(parsed.phase_name);
    let matched = scorecardPhases.find((sp) => normalize(sp.phase_name) === normalizedParsed);
    if (!matched) {
      matched = scorecardPhases.find(
        (sp) =>
          normalizedParsed.includes(normalize(sp.phase_name)) ||
          normalize(sp.phase_name).includes(normalizedParsed)
      );
    }
    if (!matched && idx < scorecardPhases.length) {
      matched = scorecardPhases[idx];
    }
    return {
      phase_id: matched ? matched.phase_id : normalize(parsed.phase_name).replace(/\s+/g, '_'),
      phase_name: parsed.phase_name,
      score: parsed.score,
      score_max: parsed.score_max,
    };
  });
}

function detectConversionDiscrepancy(claudeLeadStatus, userAvanzo) {
  if (!claudeLeadStatus) return false;
  if (userAvanzo === 'converted' && claudeLeadStatus !== 'converted') return true;
  if (userAvanzo === 'lost_captadora' && claudeLeadStatus === 'converted') return true;
  return false;
}

// ─── User stats ────────────────────────────────────────────

async function updateUserStats(env, userId, orgId) {
  const analyses = await supabaseSelect(
    env,
    'analysis_phases',
    `user_id=eq.${userId}&order=created_at.desc&limit=50`
  );

  if (analyses.length > 0) {
    const uniqueAnalysisIds = [...new Set(analyses.map((a) => a.analysis_id))].slice(0, 5);
    const recentPhases = analyses.filter((a) => uniqueAnalysisIds.includes(a.analysis_id));

    const phaseAvgs = {};
    for (const p of recentPhases) {
      if (!phaseAvgs[p.phase_id]) phaseAvgs[p.phase_id] = { total: 0, max: 0, name: p.phase_name };
      phaseAvgs[p.phase_id].total += p.score;
      phaseAvgs[p.phase_id].max += p.score_max;
    }

    let worstPhase = null;
    let worstRatio = 1;
    for (const [, avg] of Object.entries(phaseAvgs)) {
      const ratio = avg.max > 0 ? avg.total / avg.max : 1;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstPhase = avg.name;
      }
    }

    if (worstPhase) {
      await supabaseUpdate(env, 'users', 'id', userId, { current_focus_phase: worstPhase });
    }
  }

  const user = (
    await supabaseSelect(
      env,
      'users',
      `id=eq.${userId}&select=last_analysis_date,current_streak,longest_streak,organization_id`
    )
  )[0];
  if (!user) return;

  const funnelConfig = await supabaseSelect(
    env,
    'funnel_config',
    `organization_id=eq.${orgId}&select=working_days`
  );
  const workingDays = funnelConfig.length > 0 ? funnelConfig[0].working_days : [1, 2, 3, 4, 5];

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  if (user.last_analysis_date === todayStr) return;

  let checkDate = new Date(today);
  checkDate.setDate(checkDate.getDate() - 1);
  while (!workingDays.includes(checkDate.getDay() === 0 ? 7 : checkDate.getDay())) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  const lastWorkingDay = checkDate.toISOString().split('T')[0];

  const newStreak =
    user.last_analysis_date === lastWorkingDay ? (user.current_streak || 0) + 1 : 1;
  const newLongest = Math.max(newStreak, user.longest_streak || 0);

  await supabaseUpdate(env, 'users', 'id', userId, {
    last_analysis_date: todayStr,
    current_streak: newStreak,
    longest_streak: newLongest,
  });
}

// ─── Background processing (called via ctx.waitUntil) ──────

// ─── Structured prompt builder (path A) ────────────────────
function buildPromptFromStructure(structure, vocabulary) {
  const s = structure;
  const lines = [];

  // Role + objective
  lines.push(`Eres AurisIQ, un sistema especializado en análisis de conversaciones de ventas. ${s.objective || ''}`);

  // Context
  if (s.context) lines.push(`\n${s.context}`);

  // Tone
  if (s.tone) lines.push(`\nCuando analices siempre: ${s.tone}`);

  // Vocabulary
  if (vocabulary && vocabulary.length > 0) {
    lines.push(`\n---\nVOCABULARIO ESPECÍFICO DE ESTA ORGANIZACIÓN\nUsa estos términos tal como están definidos:`);
    for (const v of vocabulary) {
      lines.push(`- ${v.term}: ${v.definition}`);
    }
  }

  // Output format instruction
  lines.push(`\nTu output tiene exactamente ${(s.output_blocks || []).length} bloques en este orden: ${(s.output_blocks || []).map(b => b.description).join(', ')}.`);
  lines.push(`\nEl usuario te enviará la transcripción. Genera el análisis en este formato exacto:`);

  // Score block
  const scoreBlock = (s.output_blocks || []).find(b => b.key === 'score');
  if (scoreBlock) {
    lines.push(`\n---\n\n${scoreBlock.format_instruction}`);
  }

  // Phase diagnostics
  lines.push(`\n---\n\nDIAGNÓSTICO POR FASE\n`);
  for (const phase of (s.phases || [])) {
    const criteriaDetail = (phase.criteria || [])
      .filter(c => c.detail)
      .map(c => c.detail)
      .join('. ');
    const baseText = phase.prompt_base || criteriaDetail || '';
    lines.push(`${phase.name} ([puntaje]/${phase.max_score}): [${baseText}]`);
  }

  // Objections block
  const objBlock = (s.output_blocks || []).find(b => b.key === 'objeciones');
  if (objBlock) {
    lines.push(`\n---\n\nOBJECIONES DETECTADAS\n\n[Por cada objeción presente:]\n${objBlock.format_instruction}`);
  }

  // Next step block
  const nextBlock = (s.output_blocks || []).find(b => b.key === 'siguiente_paso');
  if (nextBlock) {
    lines.push(`\n---\n\nSIGUIENTE PASO CON ESTE PROSPECTO\n\n${nextBlock.format_instruction}`);
  }

  // Pattern block
  const patternBlock = (s.output_blocks || []).find(b => b.key === 'patron_error');
  if (patternBlock) {
    lines.push(`\n---\n\nPATRÓN DE ERROR PRINCIPAL\n\n${patternBlock.format_instruction}`);
  }

  return lines.join('\n');
}

async function processAnalysis(env, analysisId, body, scorecard) {
  const { user_id, organization_id } = body;
  const transcription = body.transcription_edited || body.transcription_original || body.transcription;

  try {
    // Fetch org descalification catalog to inject into prompt
    const descalCats = await getDescalCategories(env, organization_id);

    // Fetch org funnel stages for automatic stage detection
    let orgStages = [];
    try {
      orgStages = await supabaseSelect(
        env, 'funnel_stages',
        `organization_id=eq.${organization_id}&select=id,name&order=order_index.asc`
      );
    } catch { /* ignore */ }

    // Fetch org vocabulary for structured prompt
    let orgVocabulary = [];
    try {
      const orgRows = await supabaseSelect(
        env, 'organizations',
        `id=eq.${organization_id}&select=vocabulary`
      );
      if (orgRows.length > 0 && Array.isArray(orgRows[0].vocabulary)) {
        orgVocabulary = orgRows[0].vocabulary;
      }
    } catch { /* ignore */ }

    // Path A (structured) vs Path B (legacy)
    // Path A activates ONLY when:
    //   1. structure exists with phases
    //   2. template_id is set (came from a template)
    //   3. prompt_template is NULL or very short (<500 chars) — i.e. no rich legacy prompt
    // This ensures existing Inmobili/EnPagos clones (which inherited the long prompt_template)
    // stay on path B until we explicitly migrate them.
    const hasStructure = scorecard.structure
      && typeof scorecard.structure === 'object'
      && Array.isArray(scorecard.structure.phases)
      && scorecard.structure.phases.length > 0;
    const hasTemplate = !!scorecard.template_id;
    const legacyLen = (scorecard.prompt_template || '').length;
    const useStructured = hasStructure && hasTemplate && legacyLen < 500;

    console.log(`[worker] scorecard ${scorecard.name || analysisId}: structure=${hasStructure}, template_id=${hasTemplate}, prompt_legacy_len=${legacyLen}, path=${useStructured ? 'A' : 'B'}`);

    let promptWithDescal;

    if (useStructured) {
      // Path A — build from structure JSONB
      promptWithDescal = buildPromptFromStructure(scorecard.structure, orgVocabulary);

      // Tone block for patron_error (same as legacy)
      promptWithDescal += `\n\n---\nTONO Y FORMATO DEL PATRÓN DE ERROR\nEl bloque PATRÓN DE ERROR PRINCIPAL debe ser BREVE: máximo 2-3 oraciones concretas y accionables. No es un análisis completo — es un tip rápido. Usa tono de coaching positivo. Empieza con "Para tu siguiente llamada, enfócate en...", "Un área de oportunidad es...", "Esta semana puedes mejorar en...". NUNCA uses "cometió un error", "falla más común", "error costoso". El objetivo es motivar, no señalar fallos.\n\nIDIOMA: Responde completamente en español. No uses anglicismos ni palabras en inglés (no "follow-up", "lead", "goodwill", "call to action", "closing"). Usa los equivalentes en español: seguimiento, prospecto, confianza, llamado a la acción, cierre.`;
    } else {
      // Path B — legacy hardcoded
      promptWithDescal = scorecard.prompt_template;
      promptWithDescal += `\n\n---\nTONO Y FORMATO DEL PATRÓN DE ERROR\nEl bloque PATRÓN DE ERROR PRINCIPAL debe ser BREVE: máximo 2-3 oraciones concretas y accionables. No es un análisis completo — es un tip rápido. Usa tono de coaching positivo. Empieza con "Para tu siguiente llamada, enfócate en...", "Un área de oportunidad es...", "Esta semana puedes mejorar en...". NUNCA uses "cometió un error", "falla más común", "error costoso". El objetivo es motivar, no señalar fallos.\n\nIDIOMA: Responde completamente en español. No uses anglicismos ni palabras en inglés (no "follow-up", "lead", "goodwill", "call to action", "closing"). Usa los equivalentes en español: seguimiento, prospecto, confianza, llamado a la acción, cierre.`;
    }

    // Prospect extraction + checklist — read from structure JSONB, fallback to legacy constants
    const vertical = scorecard.vertical || 'inmobiliario';
    const structure = scorecard.structure || {};

    // ─── Legacy constants (fallback, remove after 2026-05-12) ───
    const PROSPECT_BLOCK_LEGACY = {
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
    const CHECKLIST_BLOCK_LEGACY = {
      inmobiliario: `Los 26 campos del checklist son: Nombre completo, Dirección de la propiedad, Dirección INE, Estado civil, Libre de gravamen, Pagos puntuales, Adeudos en tiempo consecutivo, Crédito individual o conyugal, NSS, NC, Papelería/escrituras, Descripción del domicilio, Casa habitada o desocupada, Servicios a nombre de quién, Adeudos de servicios, Financiamiento de adeudos, Motivo de venta, Expectativa del cliente, Precio estimado de venta, Precio estimado de captación, Disponibilidad para visita, Fecha y hora propuesta, Lectura de urgencia, Lectura de disposición, Lectura de resistencia, Promesa de venta.`,
      financiero: `Los 14 campos del checklist son: Nombre del titular, Nombre del negocio, Tipo de negocio, Ubicación del negocio, Antigüedad del negocio, Ingresos mensuales estimados, Equipo que necesita financiar, Monto de crédito solicitado, Plazo deseado, Enganche disponible, Historial crediticio, Documentación disponible, Disponibilidad para visita, Fecha y hora propuesta.`,
    };

    // ─── Resolve from DB or legacy ───
    // NOTE: V5B (visita presencial) has checklist_fields=[] by design — data is
    // captured during V5A call, not during the visit. Empty array correctly falls
    // through to legacy, which is the intended behavior.
    const dbChecklistFields = Array.isArray(structure.checklist_fields) && structure.checklist_fields.length > 0
      ? structure.checklist_fields : null;
    const dbProspectFields = Array.isArray(structure.prospect_fields) && structure.prospect_fields.length > 0
      ? structure.prospect_fields : null;
    const dbExtractionPatterns = Array.isArray(structure.extraction_patterns) && structure.extraction_patterns.length > 0
      ? structure.extraction_patterns : null;

    const checklistSource = dbChecklistFields ? 'db' : 'legacy';
    const prospectSource = dbProspectFields ? 'db' : 'legacy';
    const extractionSource = dbExtractionPatterns ? 'db' : 'legacy';

    console.log(`[worker] checklist source: ${checklistSource} — template_id=${scorecard.template_id || 'null'}, db_fields=${dbChecklistFields ? dbChecklistFields.length : 0}`);
    console.log(`[worker] prospect source: ${prospectSource} — db_fields=${dbProspectFields ? dbProspectFields.length : 0}`);
    console.log(`[worker] extraction source: ${extractionSource} — db_patterns=${dbExtractionPatterns ? dbExtractionPatterns.length : 0}`);

    // Build prospect extraction block
    let prospectFields;
    if (dbProspectFields) {
      prospectFields = dbProspectFields
        .map(f => `${f.key}: [${f.instruction}]`)
        .join('\n');
    } else {
      prospectFields = PROSPECT_BLOCK_LEGACY[vertical] || PROSPECT_BLOCK_LEGACY.inmobiliario;
    }

    // Build checklist block
    let checklistFields;
    if (dbChecklistFields) {
      const labels = dbChecklistFields.map(f => f.label).join(', ');
      checklistFields = `Los ${dbChecklistFields.length} campos del checklist son: ${labels}.`;
    } else {
      checklistFields = CHECKLIST_BLOCK_LEGACY[vertical] || CHECKLIST_BLOCK_LEGACY.inmobiliario;
    }

    promptWithDescal += `\n\n---\nEXTRACCION DE DATOS DEL PROSPECTO\nAl final de tu respuesta, incluye estas líneas:\n${prospectFields}\n\nCHECKLIST: [JSON array con cada campo evaluado]\nFormato: [{"field":"Nombre del titular","covered":true},{"field":"Tipo de negocio","covered":true},...]\n${checklistFields}\nMarca covered=true si el asesor PREGUNTÓ o mencionó ese punto, covered=false si no.`;

    if (orgStages.length > 0) {
      const stageList = orgStages.map(s => `- ${s.name}`).join('\n');
      promptWithDescal += `\n\n---\nDETECCIÓN DE ETAPA DEL EMBUDO\nBasándote en el contenido de la conversación, identifica en cuál de estas etapas del embudo se encuentra esta llamada:\n${stageList}\n\nAl final de tu respuesta incluye una línea con el formato exacto:\nETAPA_DETECTADA: [nombre exacto de la etapa]\n\nUsa exactamente el nombre tal como aparece en la lista. Si no puedes determinar la etapa con confianza razonable, escribe:\nETAPA_DETECTADA: null`;
    }

    if (descalCats.length > 0) {
      const catList = descalCats.map(c => `- ${c.code}: ${c.label}`).join('\n');
      promptWithDescal += `\n\n---\nDESCALIFICACION DE LEADS\nAnaliza la transcripción y determina si el lead fue descalificado. Usa SOLO los siguientes códigos del catálogo de la organización:\n${catList}\n\nAl final de tu respuesta, incluye una línea con el formato:\nDESCALIFICACION: ["codigo1", "codigo2", "codigo3"]\nSi el lead calificó (no hay razón de descalificación), escribe:\nDESCALIFICACION: []\nMáximo 3 códigos. Usa SOLO códigos del catálogo anterior.\n\nINSTRUCCION CRITICA: Si la llamada menciona MULTIPLES razones de descalificación concurrentes, DEBES devolver TODAS las que apliquen hasta un máximo de 3. NO filtres. NO priorices. NO te limites a 2.\n\nEjemplo real:\nSi el propietario dice: "la propiedad está en intestamentario con mis hermanos, no tenemos escrituras todavía, y está en Tepatitlán Jalisco"\nOutput correcto: DESCALIFICACION: ["juridico", "sin_escrituras", "fuera_de_zona"]\nOutput INCORRECTO (solo 2): DESCALIFICACION: ["juridico", "fuera_de_zona"]\n\nDevolver siempre TODAS las categorías que el prospecto mencione, no solo las más severas.`;
      console.log(`[debug-descal] org=${organization_id} descalCats=${descalCats.length} codes=[${descalCats.map(c => c.code).join(',')}]`);
    } else {
      console.log(`[debug-descal] org=${organization_id} descalCats=0 — SKIPPING descal block in prompt`);
    }

    // Highlights instruction — appended to both paths
    promptWithDescal += `\n\n---\nHIGHLIGHTS DE LA TRANSCRIPCIÓN\nIdentifica fragmentos EXACTOS de la transcripción que correspondan a momentos críticos o patrones de error. Copia el texto LITERAL de la transcripción, sin parafrasear.\n\nAl final de tu respuesta, incluye un bloque con el formato:\nHIGHLIGHTS: [{"type":"momento_critico","snippet":"<texto exacto copiado literal de la transcripción>","description":"<por qué es crítico>"},{"type":"patron_error","snippet":"<texto exacto>","description":"<qué patrón detectó>"}]\n\nReglas:\n- El snippet DEBE ser copiado literal de la transcripción, sin parafrasear ni resumir.\n- Máximo 3 highlights de tipo momento_critico y 3 de tipo patron_error.\n- Si no encuentras un fragmento relevante para algún tipo, omítelo.\n- Cada snippet debe tener entre 10 y 150 caracteres.`;

    const rawOutput = await callClaude(env, promptWithDescal, transcription);
    console.log(`[debug-claude-raw] len=${rawOutput.length} tail=${rawOutput.slice(-2000)}`);
    const parsed = parseClaudeOutput(rawOutput, dbExtractionPatterns);
    const phasesWithIds = matchPhaseIds(parsed.phases, scorecard.phases || []);

    if (phasesWithIds.length > 0) {
      await supabaseInsert(
        env,
        'analysis_phases',
        phasesWithIds.map((p) => ({
          analysis_id: analysisId,
          organization_id,
          user_id,
          phase_id: p.phase_id,
          phase_name: p.phase_name,
          score: Math.min(p.score, p.score_max),
          score_max: p.score_max,
        }))
      );
    }

    const discrepancy = detectConversionDiscrepancy(
      parsed.lead_status,
      body.avanzo_a_siguiente_etapa || 'pending'
    );

    // Validate descalification slugs against the org catalog
    const validCodes = new Set(descalCats.map(c => c.code));
    const validDescal = parsed.descalificacion.filter(code => validCodes.has(code));
    console.log(`[debug-descal-filter] claude_returned=[${parsed.descalificacion.join(',')}] valid_catalog=[${[...validCodes].join(',')}] after_filter=[${validDescal.join(',')}]`);

    // Find related prospect (same name in same org, case-insensitive)
    let relatedId = null;
    if (parsed.prospect_name && parsed.prospect_name !== 'No identificado') {
      try {
        const related = await supabaseSelect(
          env, 'analyses',
          `organization_id=eq.${organization_id}&status=eq.completado&id=neq.${analysisId}&prospect_name=ilike.${encodeURIComponent(parsed.prospect_name.trim())}&select=id&order=created_at.desc&limit=1`
        );
        if (related.length > 0) relatedId = related[0].id;
      } catch { /* ignore */ }
    }

    // Resolve detected stage name to id (case-insensitive match)
    let detectedStageId = null;
    if (parsed.detected_stage_name && orgStages.length > 0) {
      const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const target = norm(parsed.detected_stage_name);
      const match = orgStages.find(s => norm(s.name) === target);
      if (match) detectedStageId = match.id;
    }

    // Bug 4 validation: if score_general is null, Claude returned malformed output
    if (parsed.score_general === null) {
      console.error(`[debug-malformed] analysis=${analysisId} score=null clasificacion=${parsed.clasificacion} — marking as error`);
      await supabaseUpdate(env, 'analysis_jobs', 'analysis_id', analysisId, {
        status: 'error',
        error_message: 'Claude returned malformed output: score_general is null',
        completed_at: new Date().toISOString(),
      });
      await supabaseUpdate(env, 'analyses', 'id', analysisId, {
        status: 'error',
      });
      return;
    }

    console.log(`[debug-final] analysis=${analysisId} score=${parsed.score_general} clas=${parsed.clasificacion} descal=[${validDescal.join(',')}]`);

    const updatePayload = {
      score_general: Math.min(parsed.score_general, 100),
      clasificacion: parsed.clasificacion,
      momento_critico: parsed.momento_critico,
      patron_error: parsed.patron_error,
      objecion_principal: parsed.objecion_principal,
      siguiente_accion: parsed.siguiente_accion,
      conversion_discrepancy: discrepancy,
      categoria_descalificacion: validDescal.length > 0 ? validDescal : [],
      prospect_name: parsed.prospect_name,
      prospect_zone: parsed.prospect_zone,
      property_type: parsed.property_type,
      business_type: parsed.business_type,
      equipment_type: parsed.equipment_type,
      sale_reason: parsed.sale_reason,
      prospect_phone: body.prospect_phone || parsed.prospect_phone,
      checklist_results: parsed.checklist_results,
      notes: body.call_notes || null,
      related_analysis_id: relatedId,
      highlights: parsed.highlights.length > 0 ? parsed.highlights : [],
      status: 'completado',
    };

    // Only override funnel_stage_id with Claude's detection if the
    // client did not send one (respect explicit user choice).
    if (detectedStageId && !body.funnel_stage_id) {
      updatePayload.funnel_stage_id = detectedStageId;
    }

    await supabaseUpdate(env, 'analyses', 'id', analysisId, updatePayload);

    await supabaseUpdate(env, 'analysis_jobs', 'analysis_id', analysisId, {
      status: 'completado',
      completed_at: new Date().toISOString(),
    });

    await updateUserStats(env, user_id, organization_id);

    // Check for high edit pattern (3+ consecutive analyses with >40% edits)
    if ((body.edit_percentage || 0) > 40) {
      try {
        const recentJobs = await supabaseSelect(
          env, 'analysis_jobs',
          `user_id=eq.${user_id}&order=created_at.desc&limit=3&select=edit_percentage`
        );
        if (recentJobs.length >= 3 && recentJobs.every(j => (j.edit_percentage || 0) > 40)) {
          const existing = await supabaseSelect(
            env, 'alerts',
            `organization_id=eq.${organization_id}&type=eq.high_edit_pattern&status=eq.activa&select=id&limit=1`
          );
          if (existing.length === 0) {
            await supabaseInsert(env, 'alerts', {
              organization_id,
              type: 'high_edit_pattern',
              status: 'activa',
              threshold_value: 40,
              current_value: body.edit_percentage,
              description: 'Revisión recomendada — transcripciones con ediciones significativas en los últimos 3 análisis',
            });
          }
        }
      } catch (alertErr) {
        console.error('Edit alert check failed:', alertErr.message);
      }
    }
  } catch (err) {
    console.error(`Analysis ${analysisId} failed:`, err.message);
    await supabaseUpdate(env, 'analyses', 'id', analysisId, { status: 'error' });
    await supabaseUpdate(env, 'analysis_jobs', 'analysis_id', analysisId, {
      status: 'error',
      error_message: err.message,
    });
  }
}

// ─── Route: submit analysis (returns immediately) ──────────

async function handleSubmit(body, env, ctx, origin) {
  const required = ['transcription', 'user_id', 'organization_id'];
  for (const field of required) {
    if (!body[field]) {
      return jsonResponse({ error: `Missing required field: ${field}` }, 400, origin);
    }
  }

  if (body.transcription.length > 15000) {
    return jsonResponse({ error: 'Transcription exceeds 15,000 character limit' }, 400, origin);
  }

  const { organization_id } = body;
  let scorecard_id = body.scorecard_id || null;

  const org = await getOrgPlan(env, organization_id);
  if (org.access_status === 'read_only') {
    return jsonResponse({ error: 'Organization is in read-only mode' }, 403, origin);
  }

  const tierLimit = TIER_LIMITS[org.plan] !== undefined ? TIER_LIMITS[org.plan] : null;
  const quotaOk = await supabaseRpc(env, 'check_and_increment_analysis_count', {
    org_id: organization_id,
    tier_limit: tierLimit,
  });

  if (!quotaOk) {
    return jsonResponse({ error: 'Monthly analysis quota exceeded' }, 429, origin);
  }

  // SCORECARD RESOLUTION — funnel_stages is the source of truth.
  // Fetch ALL stages of the org up-front, then:
  //   1. If the client sent a funnel_stage_id that matches, use its scorecard_id
  //   2. Else use the first stage whose scorecard_id is not null
  //   3. Last resort: keep whatever the client sent
  // body.scorecard_id is never trusted if the org has stages.
  const receivedScorecard = body.scorecard_id || null;
  const receivedStage = body.funnel_stage_id || null;
  console.log('[handleSubmit] IN', {
    org: organization_id,
    received_scorecard: receivedScorecard,
    received_stage: receivedStage,
  });

  try {
    const allStages = await supabaseSelect(
      env,
      'funnel_stages',
      `organization_id=eq.${organization_id}&select=id,name,scorecard_id,order_index&order=order_index.asc`
    );
    console.log('[handleSubmit] stages fetched', {
      org: organization_id,
      count: allStages.length,
      stages: allStages.map(s => ({ id: s.id, name: s.name, scorecard_id: s.scorecard_id })),
    });

    let resolvedFrom = null;
    if (receivedStage) {
      const match = allStages.find(s => s.id === receivedStage);
      if (match && match.scorecard_id) {
        scorecard_id = match.scorecard_id;
        resolvedFrom = `stage:${match.name}`;
      }
    }
    if (!scorecard_id || resolvedFrom === null) {
      const first = allStages.find(s => s.scorecard_id);
      if (first) {
        scorecard_id = first.scorecard_id;
        resolvedFrom = `first-stage:${first.name}`;
      }
    }
    console.log('[handleSubmit] scorecard resolved', {
      org: organization_id,
      resolved_from: resolvedFrom,
      received_scorecard: receivedScorecard,
      final_scorecard: scorecard_id,
    });
  } catch (e) {
    console.error('[handleSubmit] scorecard resolution error', e);
  }

  if (!scorecard_id) {
    return jsonResponse({ error: 'No scorecard available for this organization' }, 400, origin);
  }

  const scorecard = await getScorecard(env, scorecard_id);

  const [analysis] = await supabaseInsert(env, 'analyses', {
    organization_id,
    user_id: body.user_id,
    scorecard_id,
    funnel_stage_id: body.funnel_stage_id || null,
    fuente_lead_id: body.fuente_lead_id || null,
    prospect_identifier: body.prospect_identifier || null,
    avanzo_a_siguiente_etapa: body.avanzo_a_siguiente_etapa || 'pending',
    categoria_descalificacion: [],
    status: 'procesando',
  });

  await supabaseInsert(env, 'analysis_jobs', {
    analysis_id: analysis.id,
    organization_id,
    user_id: body.user_id,
    status: 'procesando',
    processing_started_at: new Date().toISOString(),
    transcription_text: body.transcription,
    transcription_original: body.transcription_original || null,
    transcription_edited: body.transcription_edited || null,
    edit_percentage: computeEditPct(body.transcription_original, body.transcription_edited),
    has_audio: body.has_audio || false,
    pause_count: body.pause_count || 0,
    total_paused_seconds: body.total_paused_seconds || 0,
  });

  // Fire-and-forget: process in background
  ctx.waitUntil(processAnalysis(env, analysis.id, body, scorecard));

  return jsonResponse(
    { analysis_id: analysis.id, status: 'procesando' },
    202,
    origin
  );
}

// ─── Route: check analysis status ──────────────────────────

async function handleStatus(body, env, origin) {
  const { analysis_id, organization_id } = body;
  if (!analysis_id) {
    return jsonResponse({ error: 'Missing analysis_id' }, 400, origin);
  }
  if (!organization_id) {
    return jsonResponse({ error: 'Missing organization_id' }, 400, origin);
  }

  const rows = await supabaseSelect(
    env,
    'analyses',
    `id=eq.${analysis_id}&organization_id=eq.${organization_id}&select=id,status,score_general,clasificacion,patron_error,siguiente_accion,conversion_discrepancy,objecion_principal,momento_critico,created_at`
  );

  if (!rows.length) {
    return jsonResponse({ error: 'Analysis not found' }, 404, origin);
  }

  const analysis = rows[0];
  const result = { analysis_id: analysis.id, status: analysis.status };

  if (analysis.status === 'completado') {
    const phases = await supabaseSelect(
      env,
      'analysis_phases',
      `analysis_id=eq.${analysis_id}&select=phase_id,phase_name,score,score_max&order=created_at.asc`
    );

    Object.assign(result, {
      score_general: analysis.score_general,
      clasificacion: analysis.clasificacion,
      phases,
      patron_error: analysis.patron_error,
      objecion_principal: analysis.objecion_principal,
      momento_critico: analysis.momento_critico,
      siguiente_accion: analysis.siguiente_accion,
      conversion_discrepancy: analysis.conversion_discrepancy,
    });
  }

  if (analysis.status === 'error') {
    const jobs = await supabaseSelect(
      env,
      'analysis_jobs',
      `analysis_id=eq.${analysis_id}&select=error_message`
    );
    if (jobs.length) result.error_message = jobs[0].error_message;
  }

  return jsonResponse(result, 200, origin);
}

// ─── Route: quota info ─────────────────────────────────────

async function handleQuota(body, env, origin) {
  const { organization_id } = body;
  if (!organization_id) {
    return jsonResponse({ error: 'Missing organization_id' }, 400, origin);
  }

  const quota = await supabaseRpc(env, 'get_org_quota', { p_org_id: organization_id });
  if (!quota) {
    return jsonResponse({ error: 'Organization not found' }, 404, origin);
  }

  return jsonResponse(quota, 200, origin);
}

// ─── Route: transcribe audio via AssemblyAI ───────────────

async function handleTranscribe(body, env, origin) {
  const { audio_base64, organization_id } = body;
  if (!audio_base64 || !organization_id) {
    return jsonResponse({ error: 'Missing audio_base64 or organization_id' }, 400, origin);
  }

  // Validate org exists and is active
  const org = await getOrgPlan(env, organization_id);
  if (org.access_status === 'read_only') {
    return jsonResponse({ error: 'Organization is in read-only mode' }, 403, origin);
  }

  // Decode base64 — strip data URL prefix (data:audio/webm;codecs=opus;base64,...)
  let raw = audio_base64;
  const commaIdx = raw.indexOf(',');
  if (commaIdx !== -1 && raw.startsWith('data:')) {
    raw = raw.slice(commaIdx + 1);
  }
  const binaryStr = atob(raw);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  if (bytes.length > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: 'Audio exceeds 25MB limit' }, 400, origin);
  }

  // Upload audio to AssemblyAI
  const uploadRes = await fetch(`${ASSEMBLYAI_URL}/upload`, {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`AssemblyAI upload failed: ${uploadRes.status} ${err}`);
  }

  const { upload_url } = await uploadRes.json();

  // Start transcription
  const transcriptRes = await fetch(`${ASSEMBLYAI_URL}/transcript`, {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ audio_url: upload_url, language_code: 'es', speech_models: ['universal-3-pro'] }),
  });

  if (!transcriptRes.ok) {
    const err = await transcriptRes.text();
    throw new Error(`AssemblyAI transcript request failed: ${transcriptRes.status} ${err}`);
  }

  const { id: transcriptId } = await transcriptRes.json();

  // Poll for completion (max 120 seconds)
  const maxPolls = 40;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await fetch(`${ASSEMBLYAI_URL}/transcript/${transcriptId}`, {
      headers: { authorization: env.ASSEMBLYAI_API_KEY },
    });

    const pollData = await pollRes.json();

    if (pollData.status === 'completed') {
      if (!pollData.text || pollData.text.trim().length === 0) {
        return jsonResponse({ error: 'No se detectó audio hablado en la grabación' }, 400, origin);
      }
      return jsonResponse({ text: pollData.text }, 200, origin);
    }

    if (pollData.status === 'error') {
      return jsonResponse({ error: pollData.error || 'Error al transcribir el audio' }, 500, origin);
    }
  }

  return jsonResponse({ error: 'La transcripción está tomando demasiado tiempo. Intenta con un audio más corto.' }, 504, origin);
}

// ─── Route: generate provisional speech ───────────────────

async function handleGenerateSpeech(body, env, origin) {
  const { organization_id, funnel_stage_id } = body;
  if (!organization_id) {
    return jsonResponse({ error: 'Missing organization_id' }, 400, origin);
  }

  // Get scorecard — from funnel_stage if provided, otherwise org default
  let scorecardId = null;
  let stageName = null;
  if (funnel_stage_id) {
    const stages = await supabaseSelect(
      env, 'funnel_stages',
      `id=eq.${funnel_stage_id}&organization_id=eq.${organization_id}&select=scorecard_id,name`
    );
    if (stages.length > 0) {
      scorecardId = stages[0].scorecard_id;
      stageName = stages[0].name;
    }
  }

  // Fallback to org's active scorecard
  if (!scorecardId) {
    const scs = await supabaseSelect(
      env, 'scorecards',
      `active=eq.true&or=(organization_id.eq.${organization_id},organization_id.is.null)&select=id&order=organization_id.desc.nullslast&limit=1`
    );
    if (scs.length > 0) scorecardId = scs[0].id;
  }

  if (!scorecardId) {
    return jsonResponse({ error: 'No scorecard found' }, 404, origin);
  }

  const scorecard = await getScorecard(env, scorecardId);
  const phases = scorecard.phases || [];

  if (phases.length === 0) {
    return jsonResponse({ error: 'Scorecard has no phases' }, 400, origin);
  }

  // Get org name for the prompt
  const orgs = await supabaseSelect(env, 'organizations', `id=eq.${organization_id}&select=name`);
  const orgName = orgs.length > 0 ? orgs[0].name : 'la empresa';

  // Load checklist items from DB if stage is specified
  let stageItems = [];
  if (funnel_stage_id) {
    try {
      stageItems = await supabaseSelect(
        env, 'stage_checklist_items',
        `funnel_stage_id=eq.${funnel_stage_id}&active=eq.true&select=label,description&order=sort_order`
      );
    } catch { /* ignore — proceed without items */ }
  }

  // Extract business context from scorecard structure
  const structure = scorecard.structure || {};
  const businessContext = structure.context || '';
  const businessObjective = structure.objective || '';
  const vertical = scorecard.vertical || 'general';

  const systemPrompt = `Eres AurisIQ. Genera frases modelo para un Speech Ideal de venta. La empresa se llama "${orgName}". Usa SOLO este nombre — NO inventes otros nombres de empresa. Las frases deben sonar naturales, en español mexicano, y ser directamente usables en una llamada real. Cada frase es algo que el vendedor dirá literalmente al prospecto.

CONTEXTO DEL NEGOCIO:
${businessObjective}
${businessContext}

REGLA CRITICA: NO inventes información sobre el producto o servicio que no esté explícitamente en el contexto del negocio o en el scorecard. Si no sabes algo específico, usa lenguaje genérico.`;

  const phasesBlock = phases.map((p, i) => {
    // Attach checklist items to the first phase (or distribute if needed)
    const itemsBlock = i === 0 && stageItems.length > 0
      ? '\nCampos a cubrir:\n' + stageItems.map(it => `- ${it.label}${it.description ? ': ' + it.description : ''}`).join('\n')
      : '';
    return `FASE ${i + 1} — ${p.phase_name || p.name || 'Fase ' + (i + 1)}:
Transición: Frase natural para entrar a esta fase.${itemsBlock}`;
  }).join('\n\n');

  const userPrompt = `La empresa se llama "${orgName}". Vertical: ${vertical}.

Scorecard:
---
${scorecard.prompt_template}
---

Genera un Speech Ideal${stageName ? ` para la etapa "${stageName}"` : ''} basado EXCLUSIVAMENTE en las fases definidas en el scorecard de arriba.

Cada fase debe tener una FRASE DE TRANSICIÓN (cómo el vendedor pasa naturalmente de un tema al siguiente) y luego CAMPOS con 3 frases alternativas cada uno (cuando aplique).

${phasesBlock}

Las frases deben sonar como una conversación real, no como un formulario. Adáptate al vertical "${vertical}" y al contexto del negocio. NO uses lenguaje inmobiliario a menos que el scorecard explícitamente lo requiera.

Responde SOLO con JSON válido, sin texto adicional:
{"phases": [{"phase_name": "nombre exacto de la fase del scorecard", "transition": "frase de transición natural", "fields": [{"field_name": "nombre del campo", "phrases": ["frase1", "frase2", "frase3"]}, ...]}, ...]}`;

  const rawOutput = await callClaude(env, systemPrompt, userPrompt);

  let result;
  try {
    const cleaned = rawOutput.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    return jsonResponse({ error: 'Failed to parse speech output' }, 500, origin);
  }

  // Save to DB in new field-based format
  const content = result;

  try {
    // Check if provisional already exists for this stage
    const stageQuery = funnel_stage_id
      ? `funnel_stage_id=eq.${funnel_stage_id}`
      : `funnel_stage_id=is.null`;
    const existing = await supabaseSelect(
      env, 'speech_versions',
      `organization_id=eq.${organization_id}&scorecard_id=eq.${scorecardId}&${stageQuery}&is_provisional=eq.true&select=id&limit=1`
    );

    if (existing.length === 0) {
      await supabaseInsert(env, 'speech_versions', {
        organization_id,
        scorecard_id: scorecardId,
        funnel_stage_id: funnel_stage_id || null,
        content,
        version_number: 0,
        published: false,
        is_provisional: true,
      });
    }
  } catch (saveErr) {
    console.error('Failed to save provisional speech:', saveErr.message);
  }

  return jsonResponse(result, 200, origin);
}

// ─── Scheduled handlers ────────────────────────────────────

async function handleTimeoutRecovery(env) {
  const cutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString();

  const staleJobs = await supabaseSelect(
    env,
    'analysis_jobs',
    `status=eq.procesando&processing_started_at=lt.${cutoff}&select=analysis_id`
  );

  let recovered = 0;
  for (const job of staleJobs) {
    await supabaseUpdate(env, 'analysis_jobs', 'analysis_id', job.analysis_id, {
      status: 'error',
      error_message: `Timeout: processing exceeded ${STALE_JOB_MINUTES} minutes`,
    });
    await supabaseUpdate(env, 'analyses', 'id', job.analysis_id, {
      status: 'error',
    });
    recovered++;
  }

  if (recovered > 0) {
    console.log(`Timeout recovery: marked ${recovered} stale job(s) as error`);
  }
}

async function handleMonthlyReset(env) {
  const affected = await supabaseRpc(env, 'reset_monthly_analysis_counts', {});
  console.log(`Monthly reset: ${affected} org(s) reset to 0`);
}

async function handleStarterExpiration(env) {
  const affected = await supabaseRpc(env, 'expire_starter_orgs', {});
  if (affected > 0) {
    console.log(`Starter expiration: ${affected} org(s) set to read_only`);
  }
}

async function handleGraceExpiration(env) {
  const affected = await supabaseRpc(env, 'expire_grace_periods', {});
  if (affected > 0) {
    console.log(`Grace expiration: ${affected} org(s) set to read_only`);
  }
}

async function handleScheduled(env, cron) {
  // All crons run every 5 min; filter by time for daily/monthly tasks
  await handleTimeoutRecovery(env);
  await handleGraceExpiration(env);

  const now = new Date();

  // Daily at midnight-ish (first cron run of the day: hour 0, minute 0-4)
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
    await handleStarterExpiration(env);
  }

  // Monthly on day 1, midnight-ish
  if (now.getUTCDate() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
    await handleMonthlyReset(env);
  }
}

// ─── Stripe webhook ────────────────────────────────────────

const PRICE_TO_PLAN = {
  'price_1TGZzFEhAsKsSoSLuXZV8p7q': 'growth',
  'price_1TGZzGEhAsKsSoSLuO2TlYOb': 'pro',
  'price_1TGZzIEhAsKsSoSLQvZ5k5hJ': 'scale',
  'price_1TGZzJEhAsKsSoSLEhwK8hcd': 'enterprise',
};

// ─── Vambe webhook (Inmobili CAPI — stage.changed → CAPI events) ────

const INMOBILI_RELEVANT_PIPELINES = new Set([
  '1cac8d42-0e2c-4266-a574-50e6dedf1005', // Comarca Lagunera
  '7c3421f1-902b-454b-9765-32ed5fc04eba', // Torreón Centro 002
]);

const INMOBILI_STAGE_EVENT_MAP = {
  'Calificación': 'Lead',
  'Agendados - Llamada': 'Contact',
  'Descartados': 'Lead',
  'Calificados para visita': 'CompleteRegistration',
  'Agendados Visita': 'Schedule',
  'A espera de aceptación': 'SubmitApplication',
  'Promoción para venta': 'Purchase',
};

const INMOBILI_NOTIF_CHANNEL = 'C0ATR1TTEFM'; // #notif-captaciones-inmobili
const INMOBILI_PURCHASE_VALUE = 60000;
const STAGE_CACHE_TTL = 6 * 3600; // 6 hours

async function getStageNameCached(stageId, pipelineId, env) {
  // Try KV cache first
  if (env.STAGE_CACHE) {
    const cached = await env.STAGE_CACHE.get(`stage:${stageId}`);
    if (cached) return cached;
  }

  // Cold miss: fetch all stages for this pipeline
  const resp = await fetch('https://api.vambe.me/api/public/pipeline', {
    headers: { 'x-api-key': env.INMOBILI_VAMBE_API_KEY },
  });
  if (!resp.ok) {
    console.error(`[vambe] Pipeline fetch failed: ${resp.status}`);
    return null;
  }

  const pipelines = await resp.json();
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  if (!pipeline || !pipeline.stages) return null;

  // Populate cache for all stages
  if (env.STAGE_CACHE) {
    for (const s of pipeline.stages) {
      await env.STAGE_CACHE.put(`stage:${s.id}`, s.name, { expirationTtl: STAGE_CACHE_TTL });
    }
  }

  const match = pipeline.stages.find((s) => s.id === stageId);
  return match ? match.name : null;
}

function hashSha256Hex(value) {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(value.toLowerCase().trim()))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
}

async function hashPhoneMx(phone) {
  const digits = phone.replace(/\D/g, '');
  let base;
  if (digits.length === 10) base = digits;
  else if (digits.length === 13 && digits.startsWith('521')) base = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('52')) base = digits.slice(2);
  else base = digits.slice(-10);

  return [
    await hashSha256Hex(`521${base}`),
    await hashSha256Hex(`52${base}`),
  ];
}

function buildEventId(phone, eventName, dateIso) {
  const encoder = new TextEncoder();
  const raw = `${phone}|${eventName}|${dateIso}`;
  return crypto.subtle.digest('SHA-256', encoder.encode(raw))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32));
}

async function processVambeStageChange(payload, env) {
  const data = payload.data || payload;
  const contactId = data.contact_id;
  const newStageId = data.new_stage_id;
  const pipelineId = data.pipeline_id;

  if (!contactId || !newStageId || !pipelineId) {
    console.log('[vambe] Missing required fields in payload');
    return;
  }

  // Filter: only relevant pipelines
  if (!INMOBILI_RELEVANT_PIPELINES.has(pipelineId)) {
    console.log(`[vambe] Pipeline ${pipelineId} not relevant, ignoring`);
    return;
  }

  // Resolve stage name
  const stageName = await getStageNameCached(newStageId, pipelineId, env);
  if (!stageName) {
    console.error(`[vambe] Could not resolve stage ${newStageId}`);
    return;
  }

  // Map to CAPI event
  const eventName = INMOBILI_STAGE_EVENT_MAP[stageName];
  if (!eventName) {
    console.log(`[vambe] Stage '${stageName}' not mapped, ignoring`);
    return;
  }

  console.log(`[vambe] Stage '${stageName}' → ${eventName} for contact ${contactId}`);

  // Fetch contact data from Vambe
  const contactResp = await fetch(`https://api.vambe.me/api/public/contact/${contactId}/info`, {
    headers: { 'x-api-key': env.INMOBILI_VAMBE_API_KEY },
  });
  if (!contactResp.ok) {
    console.error(`[vambe] Contact fetch failed: ${contactResp.status}`);
    return;
  }
  const contact = await contactResp.json();

  const phone = (contact.phone || '').replace(/\D/g, '');
  if (phone.length < 10) {
    console.error(`[vambe] Invalid phone for contact ${contactId}`);
    return;
  }

  // Build user_data
  const ph = await hashPhoneMx(phone);
  const userData = {
    ph,
    country: [await hashSha256Hex('mx')],
  };

  // Enrich with name/email if available
  const name = (contact.name || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts[0]) userData.fn = [await hashSha256Hex(parts[0])];
    if (parts.slice(1).join(' ')) userData.ln = [await hashSha256Hex(parts.slice(1).join(' '))];
  }
  if (contact.email) userData.em = [await hashSha256Hex(contact.email)];
  if (contact.id) userData.external_id = contact.id;

  // Future-proof: UTMs
  if (contact.referral?.fbc) userData.fbc = contact.referral.fbc;
  if (contact.referral?.fbp) userData.fbp = contact.referral.fbp;

  // Build event
  const todayIso = new Date().toISOString().split('T')[0];
  const eventId = await buildEventId(phone, eventName, todayIso);
  const eventTime = Math.floor(Date.now() / 1000);

  const event = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'chat',
    user_data: userData,
  };

  // Custom data for specific events
  if (eventName === 'Purchase') {
    event.custom_data = { currency: 'MXN', value: INMOBILI_PURCHASE_VALUE };
  }
  if (eventName === 'Lead' && stageName === 'Descartados') {
    event.custom_data = { status: 'disqualified' };
  }

  // Send to Meta CAPI
  const pixelId = env.INMOBILI_META_PIXEL_ID;
  const capiToken = env.INMOBILI_META_CAPI_TOKEN;

  if (!pixelId || !capiToken) {
    console.error('[vambe] INMOBILI_META_PIXEL_ID or CAPI_TOKEN not configured');
    return;
  }

  const capiPayload = new URLSearchParams({
    data: JSON.stringify([event]),
    access_token: capiToken,
  });

  const capiResp = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events`, {
    method: 'POST',
    body: capiPayload.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (capiResp.ok) {
    const result = await capiResp.json();
    console.log(`[vambe] CAPI ${eventName}: received=${result.events_received} warnings=${(result.messages || []).length}`);
  } else {
    console.error(`[vambe] CAPI error: ${capiResp.status} ${await capiResp.text()}`);
    return;
  }

  // Notify Slack only for Purchase
  if (eventName === 'Purchase' && env.SLACK_TOKEN) {
    const propiedad = contact.metadata?.propiedad || 'Propiedad';
    const ciudad = contact.metadata?.ciudad || '';
    const text = `💰 *NUEVA CAPTACIÓN*\n*${name || 'Lead'}* — ${ciudad}\nAd: _pendiente atribución_\n_vía Vambe (tiempo real)_`;

    try {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SLACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: INMOBILI_NOTIF_CHANNEL,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      console.log(`[vambe] Slack notif sent for Purchase`);
    } catch (e) {
      console.error(`[vambe] Slack notif failed: ${e.message}`);
    }
  }
}

async function handleVambeWebhook(request, env, ctx) {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');

  if (!env.INMOBILI_VAMBE_WEBHOOK_SECRET || token !== env.INMOBILI_VAMBE_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  // Defensive: event || type
  const eventType = payload.event || payload.type;
  if (eventType !== 'stage.changed') {
    console.log(`[vambe] Event '${eventType}' ignored (only stage.changed handled)`);
    return new Response('ok', { status: 200 });
  }

  // Process in background
  ctx.waitUntil(processVambeStageChange(payload, env));
  return new Response('ok', { status: 200 });
}

// ─── Zadarma webhook (auto-grab EnPagos fase 1) ────────────

// Fase 1: constantes hardcoded para EnPagos. Cuando haya más orgs con Zadarma,
// mover a tabla de mapeo org ↔ Zadarma account.
const ZADARMA_ENPAGOS_ORG_ID = 'a0000000-0000-0000-0000-000000000002';
const ZADARMA_ENPAGOS_SCORECARD_ID = '9eabe664-aa2f-4720-a0c3-0d5255cafe3f';
const ZADARMA_ENPAGOS_FUNNEL_STAGE_ID = 'fa963522-16da-497c-894b-600c39fadc7b';
const ZADARMA_ENPAGOS_SYSTEM_USER_ID = '0caa88bb-814e-4e75-bc7e-320ad0f3402b';

// Filtros de calidad antes de procesar
const ZADARMA_MIN_DURATION_SECONDS = 60;
const ZADARMA_RECORDING_DELAY_MS = 40_000;
const ZADARMA_RECORDING_LIFETIME_SECONDS = 86_400;

// ─── MD5 (pure JS, required for Zadarma API auth — not in Web Crypto) ──
// Classic RFC 1321 implementation; UTF-8 via TextEncoder. Returns lowercase hex.
function md5Hex(input) {
  function rol(x, n) { return (x << n) | (x >>> (32 - n)); }
  function add(x, y) {
    const l = (x & 0xFFFF) + (y & 0xFFFF);
    const m = (x >>> 16) + (y >>> 16) + (l >>> 16);
    return ((m & 0xFFFF) << 16) | (l & 0xFFFF);
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function step(fn, a, b, c, d, x, s, t) {
    return add(rol(add(add(a, fn(b, c, d)), add(x, t)), s), b);
  }
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const numBlocks = ((len + 8) >> 6) + 1;
  const words = new Array(numBlocks * 16).fill(0);
  for (let i = 0; i < len; i++) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[numBlocks * 16 - 2] = len * 8;
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const T = [
    0xD76AA478, 0xE8C7B756, 0x242070DB, 0xC1BDCEEE, 0xF57C0FAF, 0x4787C62A, 0xA8304613, 0xFD469501,
    0x698098D8, 0x8B44F7AF, 0xFFFF5BB1, 0x895CD7BE, 0x6B901122, 0xFD987193, 0xA679438E, 0x49B40821,
    0xF61E2562, 0xC040B340, 0x265E5A51, 0xE9B6C7AA, 0xD62F105D, 0x02441453, 0xD8A1E681, 0xE7D3FBC8,
    0x21E1CDE6, 0xC33707D6, 0xF4D50D87, 0x455A14ED, 0xA9E3E905, 0xFCEFA3F8, 0x676F02D9, 0x8D2A4C8A,
    0xFFFA3942, 0x8771F681, 0x6D9D6122, 0xFDE5380C, 0xA4BEEA44, 0x4BDECFA9, 0xF6BB4B60, 0xBEBFBC70,
    0x289B7EC6, 0xEAA127FA, 0xD4EF3085, 0x04881D05, 0xD9D4D039, 0xE6DB99E5, 0x1FA27CF8, 0xC4AC5665,
    0xF4292244, 0x432AFF97, 0xAB9423A7, 0xFC93A039, 0x655B59C3, 0x8F0CCC92, 0xFFEFF47D, 0x85845DD1,
    0x6FA87E4F, 0xFE2CE6E0, 0xA3014314, 0x4E0811A1, 0xF7537E82, 0xBD3AF235, 0x2AD7D2BB, 0xEB86D391,
  ];
  const S = [
    [7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21],
  ];
  const X = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12],
    [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2],
    [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9],
  ];
  const fns = [F, G, H, I];
  for (let blk = 0; blk < numBlocks; blk++) {
    const w = words.slice(blk * 16, blk * 16 + 16);
    const AA = a, BB = b, CC = c, DD = d;
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 16; i++) {
        const tIdx = round * 16 + i;
        const s = S[round][i % 4];
        const xIdx = X[round][i];
        const next = step(fns[round], a, b, c, d, w[xIdx], s, T[tIdx]);
        a = d; d = c; c = b; b = next;
      }
    }
    a = add(a, AA); b = add(b, BB); c = add(c, CC); d = add(d, DD);
  }
  function toHex(n) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += ((n >>> (i * 8)) & 0xFF).toString(16).padStart(2, '0');
    }
    return s;
  }
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

async function hmacSha1Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function zadarmaSortedParamString(params) {
  // Canonical form used by Zadarma for signing: URLSearchParams with alphabetical keys.
  // Matches their PHP/Node signing code (querystring.stringify over sorted keys).
  const sortedKeys = Object.keys(params).sort();
  const usp = new URLSearchParams();
  for (const k of sortedKeys) usp.append(k, params[k]);
  return usp.toString();
}

async function verifyZadarmaSignature(params, signature, secret) {
  if (!signature || !secret) return false;
  const paramStr = zadarmaSortedParamString(params);
  const expected = await hmacSha1Base64(secret, paramStr);
  return expected === signature;
}

async function requestZadarmaRecording(callId, env) {
  // Zadarma API auth: sign = base64(hmac_sha1(secret, method + params + md5(params)))
  // Header: "KEY:SIGN"
  const method = '/v1/pbx/record/request/';
  const params = {
    call_id: callId,
    lifetime: String(ZADARMA_RECORDING_LIFETIME_SECONDS),
  };
  const paramStr = zadarmaSortedParamString(params);
  const md5Param = md5Hex(paramStr);
  const signature = await hmacSha1Base64(env.ZADARMA_SECRET, method + paramStr + md5Param);
  const authHeader = `${env.ZADARMA_KEY}:${signature}`;
  const url = `https://api.zadarma.com${method}?${paramStr}`;

  const res = await fetch(url, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    console.error(`[zadarma] record/request failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  if (data.status !== 'success' || !data.link) {
    console.error(`[zadarma] record/request non-success:`, data);
    return null;
  }
  return data.link;
}

// Transcribe binary audio buffer via AssemblyAI — same pattern as handleTranscribe.
async function transcribeAudioBuffer(audioBuffer, env) {
  const uploadRes = await fetch(`${ASSEMBLYAI_URL}/upload`, {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
    },
    body: audioBuffer,
  });
  if (!uploadRes.ok) {
    throw new Error(`AssemblyAI upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const { upload_url } = await uploadRes.json();

  const transcriptRes = await fetch(`${ASSEMBLYAI_URL}/transcript`, {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ audio_url: upload_url, language_code: 'es', speech_models: ['universal-3-pro'] }),
  });
  if (!transcriptRes.ok) {
    throw new Error(`AssemblyAI transcript request failed: ${transcriptRes.status} ${await transcriptRes.text()}`);
  }
  const { id: transcriptId } = await transcriptRes.json();

  const maxPolls = 60; // 60 × 3s = 180s
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${ASSEMBLYAI_URL}/transcript/${transcriptId}`, {
      headers: { authorization: env.ASSEMBLYAI_API_KEY },
    });
    const pollData = await pollRes.json();
    if (pollData.status === 'completed') {
      if (!pollData.text || pollData.text.trim().length === 0) {
        throw new Error('No speech detected in recording');
      }
      return pollData.text;
    }
    if (pollData.status === 'error') {
      throw new Error(`AssemblyAI error: ${pollData.error || 'unknown'}`);
    }
  }
  throw new Error('AssemblyAI transcription timed out');
}

async function processZadarmaCall(params, env) {
  const callIdWithRec = params.call_id_with_rec;
  const callerPhone = params.caller_id || params.destination || null;

  try {
    // 1. Wait for Zadarma to finalize the recording file
    await new Promise((r) => setTimeout(r, ZADARMA_RECORDING_DELAY_MS));

    // 2. Request the download URL from Zadarma
    const audioLink = await requestZadarmaRecording(callIdWithRec, env);
    if (!audioLink) {
      console.error(`[zadarma] No audio link for call ${callIdWithRec}`);
      return;
    }

    // 3. Download the MP3
    const audioRes = await fetch(audioLink);
    if (!audioRes.ok) {
      console.error(`[zadarma] Failed to download audio: ${audioRes.status} ${audioLink}`);
      return;
    }
    const audioBuffer = await audioRes.arrayBuffer();
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      console.error(`[zadarma] Audio exceeds 25MB limit: ${audioBuffer.byteLength} bytes, call ${callIdWithRec}`);
      return;
    }

    // 4. Transcribe with AssemblyAI (same flow as handleTranscribe)
    const transcription = await transcribeAudioBuffer(audioBuffer, env);
    console.log(`[zadarma] Transcribed call ${callIdWithRec}: ${transcription.length} chars`);

    // 5. Insert background_jobs row — cron will claim it and invoke analyze
    await supabaseInsert(env, 'background_jobs', {
      organization_id: ZADARMA_ENPAGOS_ORG_ID,
      user_id: ZADARMA_ENPAGOS_SYSTEM_USER_ID,
      type: 'analysis',
      status: 'pending',
      priority: 0,
      retry_count: 0,
      max_retries: 2,
      quota_consumed: false,
      payload: {
        scorecard_id: ZADARMA_ENPAGOS_SCORECARD_ID,
        funnel_stage_id: ZADARMA_ENPAGOS_FUNNEL_STAGE_ID,
        has_audio: true,
        transcription_text: transcription,
        transcription_original: transcription,
        transcription_edited: null,
        edit_percentage: 0,
        pause_count: 0,
        total_paused_seconds: 0,
        prospect_phone: callerPhone,
        prospect_identifier: callerPhone,
        fuente_lead_id: '',
        avanzo_a_siguiente_etapa: 'pending',
        call_notes: null,
      },
    });
    console.log(`[zadarma] Enqueued analysis job for call ${callIdWithRec}`);
  } catch (err) {
    console.error(`[zadarma] processZadarmaCall error for ${callIdWithRec}: ${err.message}`);
  }
}

async function handleZadarmaWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const params = {};
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;

  const signature = request.headers.get('Signature') || request.headers.get('signature');
  if (!env.ZADARMA_SECRET) {
    console.log('[zadarma] ZADARMA_SECRET not configured, skipping');
    return new Response('ok', { status: 200 });
  }
  if (!signature) {
    return new Response('forbidden', { status: 403 });
  }
  const valid = await verifyZadarmaSignature(params, signature, env.ZADARMA_SECRET);
  if (!valid) {
    return new Response('forbidden', { status: 403 });
  }

  const event = params.event || '';
  if (event !== 'NOTIFY_END' && event !== 'NOTIFY_OUT_END') {
    return new Response('ok', { status: 200 });
  }

  if (params.is_recorded !== '1') {
    return new Response('ok', { status: 200 });
  }

  // Quality filters
  const disposition = params.disposition || '';
  const duration = parseInt(params.duration || '0', 10);
  if (disposition !== 'answered') return new Response('ok', { status: 200 });
  if (duration < ZADARMA_MIN_DURATION_SECONDS) return new Response('ok', { status: 200 });

  if (!env.ZADARMA_KEY) {
    console.log('[zadarma] ZADARMA_KEY not configured, skipping');
    return new Response('ok', { status: 200 });
  }

  // Respond immediately; background-process the call
  ctx.waitUntil(processZadarmaCall(params, env));
  return new Response('ok', { status: 200 });
}

// ─── Stripe webhook ────────────────────────────────────────

async function verifyStripeSignature(request, secret) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) throw new Error('Missing stripe-signature header');

  const parts = {};
  for (const item of sig.split(',')) {
    const [key, val] = item.split('=');
    parts[key.trim()] = val;
  }

  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) throw new Error('Invalid stripe-signature format');

  // Reject events older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) throw new Error('Stripe event too old');

  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed !== expectedSig) throw new Error('Invalid stripe signature');

  return JSON.parse(body);
}

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe API error: ${res.status}`);
  return res.json();
}

async function handleStripeWebhook(request, env) {
  const event = await verifyStripeSignature(request, env.STRIPE_WEBHOOK_SECRET);

  // Idempotency: skip if already processed
  const existing = await supabaseSelect(env, 'stripe_events', `id=eq.${event.id}&select=id`);
  if (existing.length > 0) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  // Log event for idempotency
  await supabaseInsert(env, 'stripe_events', { id: event.id, type: event.type });

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;

      // Get subscription to find the price/plan
      let plan = session.metadata?.aurisiq_plan;
      if (!plan && session.subscription) {
        const sub = await stripeGet(env, `/subscriptions/${session.subscription}`);
        const priceId = sub.items?.data?.[0]?.price?.id;
        plan = PRICE_TO_PLAN[priceId] || sub.items?.data?.[0]?.price?.metadata?.aurisiq_plan;
      }

      if (!plan) {
        console.error('checkout.session.completed: could not determine plan');
        break;
      }

      // Find org by metadata or client_reference_id
      const orgId = session.client_reference_id || session.metadata?.organization_id;

      await supabaseRpc(env, 'upgrade_org_plan', {
        p_stripe_customer_id: customerId,
        p_plan: plan,
        p_org_id: orgId || null,
      });

      console.log(`Checkout completed: customer=${customerId} plan=${plan} org=${orgId}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      await supabaseRpc(env, 'start_grace_period', { p_stripe_customer_id: customerId });
      console.log(`Payment failed: customer=${customerId} → grace period started`);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      await supabaseRpc(env, 'resolve_grace_period', { p_stripe_customer_id: customerId });
      console.log(`Invoice paid: customer=${customerId} → grace resolved`);
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

// ─── Entry points ──────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Vambe webhook — Inmobili CAPI stage events
    if (url.pathname === '/webhooks/vambe/inmobili') {
      if (request.method === 'POST') {
        try {
          return await handleVambeWebhook(request, env, ctx);
        } catch (err) {
          console.error('[vambe] webhook error:', err.message);
          return new Response('ok', { status: 200 });
        }
      }
      return new Response('method not allowed', { status: 405 });
    }

    // Landing stub — Inmobili (future)
    if (url.pathname === '/events/inmobili/landing') {
      return new Response(JSON.stringify({ error: 'Not implemented — landing not yet active' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Zadarma webhook — form-urlencoded, no CORS, path-based routing
    if (url.pathname === '/zadarma-webhook') {
      if (request.method === 'GET') {
        const zdEcho = url.searchParams.get('zd_echo');
        if (zdEcho) return new Response(zdEcho, { status: 200 });
        return new Response('ok', { status: 200 });
      }
      if (request.method === 'POST') {
        try {
          return await handleZadarmaWebhook(request, env, ctx);
        } catch (err) {
          console.error('[zadarma] webhook handler error:', err.message);
          return new Response('ok', { status: 200 });
        }
      }
      return new Response('method not allowed', { status: 405 });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    // Stripe webhook: detect by signature header
    if (request.headers.get('stripe-signature')) {
      try {
        return await handleStripeWebhook(request, env);
      } catch (err) {
        console.error('Stripe webhook error:', err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 400 });
      }
    }

    try {
      const body = await request.json();

      if (body.action === 'version') {
        return jsonResponse({ version: '1.3.0', service: 'aurisiq-worker' }, 200, origin);
      }

      if (body.action === 'status') {
        return await handleStatus(body, env, origin);
      }

      if (body.action === 'quota') {
        return await handleQuota(body, env, origin);
      }

      if (body.action === 'transcribe') {
        return await handleTranscribe(body, env, origin);
      }

      if (body.action === 'generate_speech') {
        return await handleGenerateSpeech(body, env, origin);
      }

      // Default: submit analysis
      return await handleSubmit(body, env, ctx, origin);
    } catch (err) {
      console.error('Worker error:', err.message);
      return jsonResponse({ error: err.message }, 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env, event.cron));
  },
};
