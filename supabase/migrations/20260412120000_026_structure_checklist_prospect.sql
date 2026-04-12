-- =============================================================
-- Migration 026: Move CHECKLIST_BLOCK + PROSPECT_BLOCK into
-- scorecard_templates.structure JSONB
--
-- Adds to each template's structure:
--   checklist_fields: [{slug, label}]  — flat list for Worker prompt
--   prospect_fields: [{key, instruction, maps_to}] — extraction instructions
--   extraction_patterns: [{key, regex, column}] — parsing patterns
--   phases[].fields: [slug, ...] — per-phase grouping for UI
--
-- V5B has no checklist (data captured in V5A call).
-- Phases are rebuilt fully to avoid WITH ORDINALITY indexing bugs.
-- =============================================================


-- ─── V5A — Captación Inmobiliaria ───────────────────────────

-- 1a. Add checklist_fields, prospect_fields, extraction_patterns
UPDATE scorecard_templates
SET structure = jsonb_set(
  jsonb_set(
    jsonb_set(
      structure,
      '{checklist_fields}',
      '[
        {"slug":"nombre_completo","label":"Nombre completo"},
        {"slug":"direccion_propiedad","label":"Dirección de la propiedad"},
        {"slug":"direccion_ine","label":"Dirección INE"},
        {"slug":"estado_civil","label":"Estado civil"},
        {"slug":"libre_gravamen","label":"Libre de gravamen"},
        {"slug":"pagos_puntuales","label":"Pagos puntuales"},
        {"slug":"adeudos_consecutivos","label":"Adeudos en tiempo consecutivo"},
        {"slug":"credito_individual_conyugal","label":"Crédito individual o conyugal"},
        {"slug":"nss","label":"NSS"},
        {"slug":"nc","label":"NC"},
        {"slug":"papeleria_escrituras","label":"Papelería/escrituras"},
        {"slug":"descripcion_domicilio","label":"Descripción del domicilio"},
        {"slug":"casa_habitada_desocupada","label":"Casa habitada o desocupada"},
        {"slug":"servicios_nombre","label":"Servicios a nombre de quién"},
        {"slug":"adeudos_servicios","label":"Adeudos de servicios"},
        {"slug":"financiamiento_adeudos","label":"Financiamiento de adeudos"},
        {"slug":"motivo_venta","label":"Motivo de venta"},
        {"slug":"expectativa_cliente","label":"Expectativa del cliente"},
        {"slug":"precio_estimado_venta","label":"Precio estimado de venta"},
        {"slug":"precio_estimado_captacion","label":"Precio estimado de captación"},
        {"slug":"disponibilidad_visita","label":"Disponibilidad para visita"},
        {"slug":"fecha_hora_propuesta","label":"Fecha y hora propuesta"},
        {"slug":"lectura_urgencia","label":"Lectura de urgencia"},
        {"slug":"lectura_disposicion","label":"Lectura de disposición"},
        {"slug":"lectura_resistencia","label":"Lectura de resistencia"},
        {"slug":"promesa_venta","label":"Promesa de venta"}
      ]'::jsonb
    ),
    '{prospect_fields}',
    '[
      {"key":"PROSPECTO_NOMBRE","instruction":"nombre del prospecto si se menciona, o \"No identificado\"","maps_to":"prospect_name"},
      {"key":"PROSPECTO_ZONA","instruction":"colonia, zona o municipio si se menciona, o \"No identificada\"","maps_to":"prospect_zone"},
      {"key":"TIPO_PROPIEDAD","instruction":"casa, departamento, terreno, local, o \"No identificado\"","maps_to":"property_type"},
      {"key":"MOTIVO_VENTA","instruction":"razón por la que vende, o \"No mencionado\"","maps_to":"sale_reason"},
      {"key":"PROSPECTO_TELEFONO","instruction":"número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o \"No detectado\"","maps_to":"prospect_phone"}
    ]'::jsonb
  ),
  '{extraction_patterns}',
  '[
    {"key":"PROSPECTO_NOMBRE","regex":"PROSPECTO_NOMBRE:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_name"},
    {"key":"PROSPECTO_ZONA","regex":"PROSPECTO_ZONA:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_zone"},
    {"key":"TIPO_PROPIEDAD","regex":"TIPO_PROPIEDAD:\\\\s*(.+?)(?:\\\\n|$)","column":"property_type"},
    {"key":"MOTIVO_VENTA","regex":"MOTIVO_VENTA:\\\\s*(.+?)(?:\\\\n|$)","column":"sale_reason"},
    {"key":"PROSPECTO_TELEFONO","regex":"PROSPECTO_TELEFONO:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_phone"}
  ]'::jsonb
)
WHERE id = 'c0000000-0000-0000-0000-000000000001';

-- 1b. Rebuild phases with fields[] (full replacement avoids ordinality bugs)
UPDATE scorecard_templates
SET structure = jsonb_set(structure, '{phases}', '[
  {
    "name":"Apertura y Marco","max_score":10,
    "prompt_base":"¿Se presentó como captadora de la inmobiliaria? ¿Estableció el motivo de la llamada (evaluar la propiedad para venta)? ¿Obtuvo datos básicos: nombre completo, dirección de la propiedad, dirección INE, estado civil?",
    "criteria":[{"name":"presentacion","detail":"Se presentó como captadora de la inmobiliaria","weight":null},{"name":"motivo_llamada","detail":"Estableció que la llamada es para evaluar la propiedad para venta","weight":null},{"name":"datos_basicos","detail":"Obtuvo nombre completo, dirección de la propiedad, dirección INE, estado civil (casado/soltero)","weight":null}],
    "fields":["nombre_completo","direccion_propiedad","direccion_ine","estado_civil"]
  },
  {
    "name":"Calificación de la Propiedad","max_score":35,
    "prompt_base":"Esta es la fase más crítica. La captadora debe preguntar: Situación legal: ¿libre de gravamen? ¿tiene crédito hipotecario vigente? ¿crédito individual o conyugal? ¿pagos puntuales? ¿adeudos en tiempo consecutivo? NSS, NC. Papelería: ¿tiene escrituras? ¿documentación en orden? Estado físico: descripción del domicilio (tipo, tamaño, recámaras, condición), ¿casa habitada o desocupada? Servicios: ¿a nombre de quién están? ¿adeudos de servicios? ¿financiamiento de adeudos? Puntaje máximo cuando preguntó al menos 8 de estos puntos. Puntaje medio (18-34) con 4-7 puntos. Puntaje bajo (0-17) cuando fue superficial.",
    "criteria":[{"name":"situacion_legal","detail":"Libre de gravamen, crédito hipotecario vigente, individual/conyugal, pagos puntuales, adeudos consecutivos, NSS, NC","weight":null},{"name":"papeleria","detail":"Escrituras, documentación en orden","weight":null},{"name":"estado_fisico","detail":"Tipo, tamaño, recámaras, condición, habitada o desocupada","weight":null},{"name":"servicios","detail":"A nombre de quién están, adeudos de servicios, financiamiento de adeudos","weight":null}],
    "fields":["libre_gravamen","pagos_puntuales","adeudos_consecutivos","credito_individual_conyugal","nss","nc","papeleria_escrituras","descripcion_domicilio","casa_habitada_desocupada","servicios_nombre","adeudos_servicios"]
  },
  {
    "name":"Expectativa y Precio","max_score":30,
    "prompt_base":"¿Preguntó motivo de venta? ¿Obtuvo expectativa de precio del propietario? ¿Mencionó rango realista basado en zona/comparables? ¿Estableció precio estimado de captación? ¿Manejó la brecha entre expectativa y mercado?",
    "criteria":[{"name":"motivo_venta","detail":"","weight":null},{"name":"expectativa_precio","detail":"Obtuvo expectativa de precio del propietario","weight":null},{"name":"rango_realista","detail":"Mencionó rango basado en zona/comparables","weight":null},{"name":"precio_captacion","detail":"Estableció precio estimado de captación","weight":null},{"name":"manejo_brecha","detail":"Diferencia entre expectativa del propietario y mercado real","weight":null}],
    "fields":["financiamiento_adeudos","motivo_venta","expectativa_cliente","precio_estimado_venta","precio_estimado_captacion"]
  },
  {
    "name":"Avance a Visita","max_score":15,
    "prompt_base":"¿Preguntó disponibilidad para visita? ¿Propuso fecha y hora concretas? ¿Manejó objeciones de agenda? Si no logró la cita, ¿dejó siguiente paso claro?",
    "criteria":[{"name":"disponibilidad","detail":"Preguntó si puede recibir visita","weight":null},{"name":"fecha_hora","detail":"Propuso fecha y hora concretas","weight":null},{"name":"objeciones_agenda","detail":"","weight":null},{"name":"siguiente_paso","detail":"Si no logró cita, dejó paso claro","weight":null}],
    "fields":["disponibilidad_visita","fecha_hora_propuesta"]
  },
  {
    "name":"Lectura del Propietario","max_score":10,
    "prompt_base":"¿Identificó nivel de urgencia del propietario? ¿Adaptó su tono? ¿Detectó señales de disposición o resistencia a vender?",
    "criteria":[{"name":"urgencia","detail":"Identificó nivel de urgencia del propietario","weight":null},{"name":"tono_adaptado","detail":"Adaptó su tono según el propietario","weight":null},{"name":"senales","detail":"Detectó señales de disposición o resistencia a vender","weight":null}],
    "fields":["lectura_urgencia","lectura_disposicion","lectura_resistencia","promesa_venta"]
  }
]'::jsonb)
WHERE id = 'c0000000-0000-0000-0000-000000000001';


-- ─── V5B — Visita Presencial (no checklist) ─────────────────

UPDATE scorecard_templates
SET structure = jsonb_set(
  jsonb_set(
    jsonb_set(
      structure,
      '{checklist_fields}',
      '[]'::jsonb
    ),
    '{prospect_fields}',
    '[
      {"key":"PROSPECTO_NOMBRE","instruction":"nombre del prospecto si se menciona, o \"No identificado\"","maps_to":"prospect_name"},
      {"key":"PROSPECTO_ZONA","instruction":"colonia, zona o municipio si se menciona, o \"No identificada\"","maps_to":"prospect_zone"},
      {"key":"TIPO_PROPIEDAD","instruction":"casa, departamento, terreno, local, o \"No identificado\"","maps_to":"property_type"},
      {"key":"MOTIVO_VENTA","instruction":"razón por la que vende, o \"No mencionado\"","maps_to":"sale_reason"},
      {"key":"PROSPECTO_TELEFONO","instruction":"número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o \"No detectado\"","maps_to":"prospect_phone"}
    ]'::jsonb
  ),
  '{extraction_patterns}',
  '[
    {"key":"PROSPECTO_NOMBRE","regex":"PROSPECTO_NOMBRE:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_name"},
    {"key":"PROSPECTO_ZONA","regex":"PROSPECTO_ZONA:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_zone"},
    {"key":"TIPO_PROPIEDAD","regex":"TIPO_PROPIEDAD:\\\\s*(.+?)(?:\\\\n|$)","column":"property_type"},
    {"key":"MOTIVO_VENTA","regex":"MOTIVO_VENTA:\\\\s*(.+?)(?:\\\\n|$)","column":"sale_reason"},
    {"key":"PROSPECTO_TELEFONO","regex":"PROSPECTO_TELEFONO:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_phone"}
  ]'::jsonb
)
WHERE id = 'c0000000-0000-0000-0000-000000000002';


-- ─── v1 — Financiero/Crédito (12 checklist fields) ──────────

-- 3a. Add top-level fields
UPDATE scorecard_templates
SET structure = jsonb_set(
  jsonb_set(
    jsonb_set(
      structure,
      '{checklist_fields}',
      '[
        {"slug":"nombre_titular","label":"Nombre del titular"},
        {"slug":"nombre_negocio","label":"Nombre del negocio"},
        {"slug":"tipo_negocio","label":"Tipo de negocio"},
        {"slug":"ubicacion_negocio","label":"Ubicación del negocio"},
        {"slug":"antiguedad_negocio","label":"Antigüedad del negocio"},
        {"slug":"ingresos_mensuales","label":"Ingresos mensuales estimados"},
        {"slug":"equipo_financiar","label":"Equipo que necesita financiar"},
        {"slug":"monto_credito","label":"Monto de crédito solicitado"},
        {"slug":"plazo_deseado","label":"Plazo deseado"},
        {"slug":"enganche_disponible","label":"Enganche disponible"},
        {"slug":"historial_crediticio","label":"Historial crediticio"},
        {"slug":"documentacion_disponible","label":"Documentación disponible"}
      ]'::jsonb
    ),
    '{prospect_fields}',
    '[
      {"key":"PROSPECTO_NOMBRE","instruction":"nombre del prospecto si se menciona, o \"No identificado\"","maps_to":"prospect_name"},
      {"key":"PROSPECTO_ZONA","instruction":"colonia, zona o municipio del negocio si se menciona, o \"No identificada\"","maps_to":"prospect_zone"},
      {"key":"TIPO_NEGOCIO","instruction":"tortillería, tienda de abarrotes, taller, ambulante, etc. o \"No mencionado\"","maps_to":"business_type"},
      {"key":"TIPO_EQUIPO","instruction":"horno, vitrina, refrigerador, máquina tortilladora, etc. o \"No mencionado\"","maps_to":"equipment_type"},
      {"key":"PROSPECTO_TELEFONO","instruction":"número de teléfono/WhatsApp del prospecto si aparece en la transcripción, o \"No detectado\"","maps_to":"prospect_phone"}
    ]'::jsonb
  ),
  '{extraction_patterns}',
  '[
    {"key":"PROSPECTO_NOMBRE","regex":"PROSPECTO_NOMBRE:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_name"},
    {"key":"PROSPECTO_ZONA","regex":"PROSPECTO_ZONA:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_zone"},
    {"key":"TIPO_NEGOCIO","regex":"TIPO_NEGOCIO:\\\\s*(.+?)(?:\\\\n|$)","column":"business_type"},
    {"key":"TIPO_EQUIPO","regex":"TIPO_EQUIPO:\\\\s*(.+?)(?:\\\\n|$)","column":"equipment_type"},
    {"key":"PROSPECTO_TELEFONO","regex":"PROSPECTO_TELEFONO:\\\\s*(.+?)(?:\\\\n|$)","column":"prospect_phone"}
  ]'::jsonb
)
WHERE id = 'c0000000-0000-0000-0000-000000000003';

-- 3b. Rebuild phases with fields[]
UPDATE scorecard_templates
SET structure = jsonb_set(structure, '{phases}', '[
  {
    "name":"Apertura y Control","max_score":15,
    "prompt_base":"¿Se presentó correctamente? ¿Estableció el control de la conversación desde el inicio?",
    "criteria":[{"name":"presentacion","detail":"","weight":null},{"name":"control_conversacion","detail":"","weight":null}],
    "fields":["nombre_titular","nombre_negocio"]
  },
  {
    "name":"Descubrimiento de Necesidades","max_score":25,
    "prompt_base":"¿Qué preguntas hizo y cuáles faltaron para entender la necesidad del prospecto?",
    "criteria":[{"name":"preguntas_realizadas","detail":"","weight":null},{"name":"preguntas_faltantes","detail":"","weight":null}],
    "fields":["tipo_negocio","ubicacion_negocio","antiguedad_negocio","ingresos_mensuales","equipo_financiar","monto_credito","plazo_deseado","enganche_disponible","historial_crediticio","documentacion_disponible"]
  },
  {
    "name":"Manejo de Objeciones","max_score":25,
    "prompt_base":"Cada objeción que apareció y cómo respondió. Incluir respuesta recomendada si falló.",
    "criteria":[{"name":"deteccion","detail":"Cada objeción que apareció en la conversación","weight":null},{"name":"respuesta","detail":"Cómo respondió el vendedor","weight":null},{"name":"recomendacion","detail":"Respuesta recomendada si la respuesta falló","weight":null}],
    "fields":[]
  },
  {
    "name":"Intento de Cierre","max_score":25,
    "prompt_base":"¿Intentó cerrar? ¿Cómo? ¿Qué quedó pendiente? Si no cerró, ¿qué debería haber dicho?",
    "criteria":[{"name":"intento","detail":"¿Intentó cerrar la venta?","weight":null},{"name":"tecnica","detail":"¿Qué técnica de cierre usó?","weight":null},{"name":"resultado","detail":"¿Qué quedó pendiente?","weight":null},{"name":"alternativa","detail":"Si no cerró, qué debería haber dicho","weight":null}],
    "fields":[]
  },
  {
    "name":"Señales del Prospecto y Adaptación","max_score":10,
    "prompt_base":"¿Leyó bien el estado emocional y disposición del prospecto? ¿Adaptó su enfoque?",
    "criteria":[{"name":"lectura_estado","detail":"","weight":null}],
    "fields":[]
  }
]'::jsonb)
WHERE id = 'c0000000-0000-0000-0000-000000000003';


-- ─── Propagate to per-org scorecards ─────────────────────────

UPDATE scorecards s
SET structure = t.structure
FROM scorecard_templates t
WHERE s.template_id = t.id
  AND s.structure IS NOT NULL;
