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
    `id=eq.${scorecardId}&select=prompt_template,phases,name,version`
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

function parseClaudeOutput(rawText) {
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
    equipment_type: null,
    sale_reason: null,
    prospect_phone: null,
    checklist_results: null,
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

  // Prospect extraction
  const nameMatch = rawText.match(/PROSPECTO_NOMBRE:\s*(.+?)(?:\n|$)/i);
  if (nameMatch) result.prospect_name = nameMatch[1].trim();
  const zoneMatch = rawText.match(/PROSPECTO_ZONA:\s*(.+?)(?:\n|$)/i);
  if (zoneMatch) result.prospect_zone = zoneMatch[1].trim();
  const typeMatch = rawText.match(/TIPO_PROPIEDAD:\s*(.+?)(?:\n|$)/i);
  if (typeMatch) result.property_type = typeMatch[1].trim();
  // Financiero vertical: TIPO_NEGOCIO shares the property_type column
  const negocioMatch = rawText.match(/TIPO_NEGOCIO:\s*(.+?)(?:\n|$)/i);
  if (negocioMatch) result.property_type = negocioMatch[1].trim();
  const equipoMatch = rawText.match(/TIPO_EQUIPO:\s*(.+?)(?:\n|$)/i);
  if (equipoMatch) result.equipment_type = equipoMatch[1].trim();
  const reasonMatch = rawText.match(/MOTIVO_VENTA:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) result.sale_reason = reasonMatch[1].trim();
  const phoneMatch = rawText.match(/PROSPECTO_TELEFONO:\s*(.+?)(?:\n|$)/i);
  if (phoneMatch) {
    const digits = phoneMatch[1].replace(/\D/g, '');
    if (digits.length >= 10) result.prospect_phone = digits.slice(-10);
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
  if (descalMatch) {
    try {
      const arr = JSON.parse(descalMatch[1]);
      if (Array.isArray(arr)) result.descalificacion = arr.map(s => String(s).trim()).filter(Boolean).slice(0, 3);
    } catch { /* ignore parse errors, keep empty */ }
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

async function processAnalysis(env, analysisId, body, scorecard) {
  const { user_id, organization_id } = body;
  const transcription = body.transcription_edited || body.transcription_original || body.transcription;

  try {
    // Fetch org descalification catalog to inject into prompt
    const descalCats = await getDescalCategories(env, organization_id);
    let promptWithDescal = scorecard.prompt_template;
    // Tone guidance for patron_error — coaching-positive, never aggressive
    promptWithDescal += `\n\n---\nTONO Y FORMATO DEL PATRÓN DE ERROR\nEl bloque PATRÓN DE ERROR PRINCIPAL debe ser BREVE: máximo 2-3 oraciones concretas y accionables. No es un análisis completo — es un tip rápido. Usa tono de coaching positivo. Empieza con "Para tu siguiente llamada, enfócate en...", "Un área de oportunidad es...", "Esta semana puedes mejorar en...". NUNCA uses "cometió un error", "falla más común", "error costoso". El objetivo es motivar, no señalar fallos.\n\nIDIOMA: Responde completamente en español. No uses anglicismos ni palabras en inglés (no "follow-up", "lead", "goodwill", "call to action", "closing"). Usa los equivalentes en español: seguimiento, prospecto, confianza, llamado a la acción, cierre.`;

    // Prospect extraction + checklist
    promptWithDescal += `\n\n---\nEXTRACCION DE DATOS DEL PROSPECTO\nAl final de tu respuesta, incluye estas líneas:\nPROSPECTO_NOMBRE: [nombre del prospecto si se menciona, o "No identificado"]\nPROSPECTO_ZONA: [colonia, zona o municipio si se menciona, o "No identificada"]\nTIPO_PROPIEDAD: [casa, departamento, terreno, local, o "No identificado"]\nMOTIVO_VENTA: [razón por la que vende, o "No mencionado"]
PROSPECTO_TELEFONO: [número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o "No detectado"]\n\nCHECKLIST: [JSON array con cada campo evaluado]\nFormato: [{"field":"Nombre completo","covered":true},{"field":"Dirección de la propiedad","covered":true},...]\nLos 26 campos del checklist son: Nombre completo, Dirección de la propiedad, Dirección INE, Estado civil, Libre de gravamen, Pagos puntuales, Adeudos en tiempo consecutivo, Crédito individual o conyugal, NSS, NC, Papelería/escrituras, Descripción del domicilio, Casa habitada o desocupada, Servicios a nombre de quién, Adeudos de servicios, Financiamiento de adeudos, Motivo de venta, Expectativa del cliente, Precio estimado de venta, Precio estimado de captación, Disponibilidad para visita, Fecha y hora propuesta, Lectura de urgencia, Lectura de disposición, Lectura de resistencia, Promesa de venta.\nMarca covered=true si la captadora PREGUNTÓ o mencionó ese punto, covered=false si no.`;

    if (descalCats.length > 0) {
      const catList = descalCats.map(c => `- ${c.code}: ${c.label}`).join('\n');
      promptWithDescal += `\n\n---\nDESCALIFICACION DE LEADS\nAnaliza la transcripción y determina si el lead fue descalificado. Usa SOLO los siguientes códigos del catálogo de la organización:\n${catList}\n\nAl final de tu respuesta, incluye una línea con el formato:\nDESCALIFICACION: ["codigo1", "codigo2"]\nSi el lead calificó (no hay razón de descalificación), escribe:\nDESCALIFICACION: []\nMáximo 3 códigos. Usa SOLO códigos del catálogo anterior.`;
    }

    const rawOutput = await callClaude(env, promptWithDescal, transcription);
    const parsed = parseClaudeOutput(rawOutput);
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

    await supabaseUpdate(env, 'analyses', 'id', analysisId, {
      score_general: parsed.score_general !== null ? Math.min(parsed.score_general, 100) : null,
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
      equipment_type: parsed.equipment_type,
      sale_reason: parsed.sale_reason,
      prospect_phone: parsed.prospect_phone,
      checklist_results: parsed.checklist_results,
      related_analysis_id: relatedId,
      status: 'completado',
    });

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
  const required = ['transcription', 'scorecard_id', 'user_id', 'organization_id'];
  for (const field of required) {
    if (!body[field]) {
      return jsonResponse({ error: `Missing required field: ${field}` }, 400, origin);
    }
  }

  if (body.transcription.length > 15000) {
    return jsonResponse({ error: 'Transcription exceeds 15,000 character limit' }, 400, origin);
  }

  const { scorecard_id, organization_id } = body;

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

  const systemPrompt = `Eres AurisIQ. Genera frases modelo para un Speech Ideal de captación inmobiliaria. La empresa se llama "${orgName}". Usa SOLO este nombre — NO inventes otros nombres de empresa. Las frases deben sonar naturales, en español mexicano, y ser directamente usables en una llamada real. Cada frase es algo que la captadora diría literalmente al propietario.

REGLAS:
- Sobre adeudos de servicios: la captadora pregunta SI tiene adeudos (sí/no), pero NO saca saldos exactos en la primera llamada. Ejemplo correcto: "¿Tiene algún adeudo de luz, agua o predial?" Ejemplo INCORRECTO: "¿Cuánto debe de luz?"
- La Fase 5 DEBE incluir la promesa comercial: "${orgName} se compromete a vender la propiedad en 30 días, y si no se vende en ese plazo, baja la comisión.`;

  const userPrompt = `La empresa se llama "${orgName}". Scorecard:

---
${scorecard.prompt_template}
---

Genera un Speech Ideal${stageName ? ` para la etapa "${stageName}"` : ''}. Cada fase tiene una FRASE DE TRANSICIÓN (cómo la captadora pasa naturalmente de un tema al siguiente) y luego CAMPOS con 3 frases alternativas cada uno.

Las frases deben sonar como una conversación real, no como un formulario. La captadora habla con un propietario que quiere vender su casa.

FASE 1 — Apertura y Marco:
Transición: El saludo ES la transición. La captadora se presenta, dice que llama de ${orgName}, explica el motivo de la llamada, y rompe el hielo antes de pedir datos.
Campos:
- Saludo y presentación (presentarse, decir de dónde llama, por qué llama — como conversación, no como formulario)
- Nombre completo
- Dirección de la propiedad
- Dirección INE
- Estado civil

FASE 2 — Calificación de la Propiedad:
Transición: Conectar naturalmente con "necesito hacerle unas preguntas sobre la documentación y el estado de la casa para poder evaluarla bien".
Campos:
- Libre de gravamen / crédito hipotecario
- Pagos puntuales
- Adeudos en tiempo consecutivo
- Crédito individual o conyugal
- NSS (si no lo tiene a la mano, ofrecerle que lo pase después por WhatsApp)
- NC — Número de Crédito (si no lo tiene a la mano, ofrecerle que lo pase después por WhatsApp)
- Papelería / escrituras
- Descripción del domicilio
- Casa habitada o desocupada
- Servicios a nombre de quién
- ¿Tiene adeudos de servicios? (solo si tiene o no, NO el monto exacto — agregar "si no sabe el monto exacto no se preocupe, eso lo checamos nosotros después")
- Financiamiento de adeudos

FASE 3 — Expectativa y Precio:
Transición: Conectar con "ya con esa información, ahora hablemos de lo más importante: el precio y sus expectativas".
Campos:
- Motivo de venta
- Expectativa del cliente (preguntar de forma INDIRECTA, nunca "¿en cuánto quiere vender?" — usar: "¿tiene alguna idea de cuánto podrían valer las propiedades por su zona?", "¿ha checado precios de casas similares en su colonia?")
- Precio estimado de venta (solo una noción inicial, el precio real se da en la visita)
- Precio estimado de captación

FASE 4 — Avance a Visita:
Transición: Conectar con "su propiedad tiene potencial, el siguiente paso es que vaya a conocerla en persona".
Campos:
- Disponibilidad
- Proponer fecha y hora concretas

FASE 5 — Lectura del Propietario:
Transición: Conectar con "antes de despedirnos quiero comentarle algo importante sobre cómo trabajamos en ${orgName}".
Campos:
- Leer urgencia
- Leer disposición
- Leer resistencia
- Promesa de venta (${orgName} se compromete a vender en 30 días, si no baja la comisión)

Responde SOLO con JSON válido, sin texto adicional:
{"phases": [{"phase_name": "Apertura y Marco", "transition": "frase de transición natural", "fields": [{"field_name": "Saludo y presentación", "phrases": ["frase1", "frase2", "frase3"]}, ...]}, ...]}`;

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

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
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
