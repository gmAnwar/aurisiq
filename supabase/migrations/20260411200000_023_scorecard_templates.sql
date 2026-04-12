-- =============================================================
-- Migration 023: scorecard_templates + vocabulary + structure
-- Multi-vertical foundation — Commit 1
-- =============================================================

-- 1. scorecard_templates table
CREATE TABLE IF NOT EXISTS scorecard_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vertical_slug TEXT NOT NULL,
  description TEXT,
  structure JSONB NOT NULL DEFAULT '{}',
  default_vocabulary JSONB NOT NULL DEFAULT '[]',
  default_categories JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scorecard_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scorecard_templates_select" ON scorecard_templates
  FOR SELECT USING (get_user_role() = 'super_admin');

CREATE POLICY "scorecard_templates_modify" ON scorecard_templates
  FOR ALL USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- 2. organizations.vocabulary
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vocabulary JSONB NOT NULL DEFAULT '[]';

-- 3. scorecards new columns
ALTER TABLE scorecards
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES scorecard_templates(id),
  ADD COLUMN IF NOT EXISTS structure JSONB;

-- =============================================================
-- 4. Seed scorecard_templates from existing global scorecards
-- =============================================================

-- V5A — Captación Inmobiliaria (latest from migration 009)
INSERT INTO scorecard_templates (id, name, vertical_slug, description, structure, default_vocabulary, default_categories)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'Llamada Captación Inmobiliaria',
  'inmobiliario',
  'Evaluación de llamadas de captación de propiedades en México. Califica documentación legal, precio y avance a visita.',
  '{
    "objective": "Evaluar llamadas de captación inmobiliaria en México. Calificar si la propiedad es captable: documentación legal limpia, precio realista, propiedad accesible para mostrar.",
    "context": "Captadora llama a dueño de propiedad (casa, departamento, terreno) que publicó en portales o llegó por redes. Debe calificar: situación legal (gravámenes, crédito hipotecario, pagos, escrituras), estado físico (tipo, condición, habitada), servicios (adeudos, a nombre de quién), viabilidad de precio (expectativa vs mercado). Objeciones comunes: precio inflado por apego emocional, desconfianza hacia la inmobiliaria, resistencia a agendar visita, papelería incompleta.",
    "phases": [
      {
        "name": "Apertura y Marco",
        "max_score": 10,
        "prompt_base": "¿Se presentó como captadora de la inmobiliaria? ¿Estableció el motivo de la llamada (evaluar la propiedad para venta)? ¿Obtuvo datos básicos: nombre completo, dirección de la propiedad, dirección INE, estado civil?",
        "criteria": [
          {"name": "presentacion", "detail": "Se presentó como captadora de la inmobiliaria", "weight": null},
          {"name": "motivo_llamada", "detail": "Estableció que la llamada es para evaluar la propiedad para venta", "weight": null},
          {"name": "datos_basicos", "detail": "Obtuvo nombre completo, dirección de la propiedad, dirección INE, estado civil (casado/soltero)", "weight": null}
        ]
      },
      {
        "name": "Calificación de la Propiedad",
        "max_score": 35,
        "prompt_base": "Esta es la fase más crítica. La captadora debe preguntar: Situación legal: ¿libre de gravamen? ¿tiene crédito hipotecario vigente? ¿crédito individual o conyugal? ¿pagos puntuales? ¿adeudos en tiempo consecutivo? NSS, NC. Papelería: ¿tiene escrituras? ¿documentación en orden? Estado físico: descripción del domicilio (tipo, tamaño, recámaras, condición), ¿casa habitada o desocupada? Servicios: ¿a nombre de quién están? ¿adeudos de servicios? ¿financiamiento de adeudos? Puntaje máximo cuando preguntó al menos 8 de estos puntos. Puntaje medio (18-34) con 4-7 puntos. Puntaje bajo (0-17) cuando fue superficial.",
        "criteria": [
          {"name": "situacion_legal", "detail": "Libre de gravamen, crédito hipotecario vigente, individual/conyugal, pagos puntuales, adeudos consecutivos, NSS, NC", "weight": null},
          {"name": "papeleria", "detail": "Escrituras, documentación en orden", "weight": null},
          {"name": "estado_fisico", "detail": "Tipo, tamaño, recámaras, condición, habitada o desocupada", "weight": null},
          {"name": "servicios", "detail": "A nombre de quién están, adeudos de servicios, financiamiento de adeudos", "weight": null}
        ]
      },
      {
        "name": "Expectativa y Precio",
        "max_score": 30,
        "prompt_base": "¿Preguntó motivo de venta? ¿Obtuvo expectativa de precio del propietario? ¿Mencionó rango realista basado en zona/comparables? ¿Estableció precio estimado de captación? ¿Manejó la brecha entre expectativa y mercado?",
        "criteria": [
          {"name": "motivo_venta", "detail": "", "weight": null},
          {"name": "expectativa_precio", "detail": "Obtuvo expectativa de precio del propietario", "weight": null},
          {"name": "rango_realista", "detail": "Mencionó rango basado en zona/comparables", "weight": null},
          {"name": "precio_captacion", "detail": "Estableció precio estimado de captación", "weight": null},
          {"name": "manejo_brecha", "detail": "Diferencia entre expectativa del propietario y mercado real", "weight": null}
        ]
      },
      {
        "name": "Avance a Visita",
        "max_score": 15,
        "prompt_base": "¿Preguntó disponibilidad para visita? ¿Propuso fecha y hora concretas? ¿Manejó objeciones de agenda? Si no logró la cita, ¿dejó siguiente paso claro?",
        "criteria": [
          {"name": "disponibilidad", "detail": "Preguntó si puede recibir visita", "weight": null},
          {"name": "fecha_hora", "detail": "Propuso fecha y hora concretas", "weight": null},
          {"name": "objeciones_agenda", "detail": "", "weight": null},
          {"name": "siguiente_paso", "detail": "Si no logró cita, dejó paso claro", "weight": null}
        ]
      },
      {
        "name": "Lectura del Propietario",
        "max_score": 10,
        "prompt_base": "¿Identificó nivel de urgencia del propietario? ¿Adaptó su tono? ¿Detectó señales de disposición o resistencia a vender?",
        "criteria": [
          {"name": "urgencia", "detail": "Identificó nivel de urgencia del propietario", "weight": null},
          {"name": "tono_adaptado", "detail": "Adaptó su tono según el propietario", "weight": null},
          {"name": "senales", "detail": "Detectó señales de disposición o resistencia a vender", "weight": null}
        ]
      }
    ],
    "output_blocks": [
      {"key": "score", "description": "Score general 0-100", "format_instruction": "SCORE GENERAL: [0-100] Clasificación: [excelente/buena/regular/deficiente]"},
      {"key": "diagnostico_fases", "description": "Evaluación por fase con puntaje", "format_instruction": "Cada fase con ([puntaje]/max): [evaluación con citas específicas de la transcripción]"},
      {"key": "objeciones", "description": "Objeciones detectadas", "format_instruction": "Por cada: Objeción + Respuesta captadora + Evaluación (funcionó/no/podría mejorar) + Respuesta recomendada"},
      {"key": "siguiente_paso", "description": "Siguiente paso con el prospecto", "format_instruction": "Estado del lead (converted/lost_captadora/lost_external/pending) + Razonamiento + Acción concreta 24-48h + Mensaje WhatsApp 3 líneas"},
      {"key": "patron_error", "description": "Patrón de error principal", "format_instruction": "3-4 oraciones sobre error más estructural. Tono coach, no crítico. Específico, no genérico."}
    ],
    "tone": "Coach experimentado, directo y específico. No crítico. Citar momentos específicos de la transcripción. Dar recomendación accionable por cada brecha — instrucciones, no observaciones. Siempre terminar con el siguiente paso más importante."
  }'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

-- V5B — Visita Presencial Inmobiliaria
INSERT INTO scorecard_templates (id, name, vertical_slug, description, structure, default_vocabulary, default_categories)
VALUES (
  'c0000000-0000-0000-0000-000000000002',
  'Visita Presencial Inmobiliaria',
  'inmobiliario',
  'Evaluación de visitas presenciales de captación. Rapport, validación de propiedad, estrategia de venta y cierre de exclusiva.',
  '{
    "objective": "Evaluar visitas presenciales inmobiliarias. La captadora visita la propiedad para evaluar condiciones, tomar fotos, validar documentación, presentar estrategia de comercialización y cerrar contrato de exclusiva.",
    "context": "Objeciones comunes durante visita: resistencia a firmar exclusiva, desacuerdo con precio sugerido, comisión de la inmobiliaria, experiencias negativas con otras agencias, querer ver si se vende solo primero. Cuello de botella: no presentar estrategia convincente y no pedir cierre de exclusiva con firmeza.",
    "phases": [
      {
        "name": "Rapport y Primera Impresión",
        "max_score": 10,
        "prompt_base": "¿Llegó puntual? ¿Se presentó con profesionalismo? ¿Generó confianza y conexión personal antes de hablar de negocio? ¿Hizo comentarios positivos sobre la propiedad?",
        "criteria": [
          {"name": "puntualidad", "detail": "", "weight": null},
          {"name": "profesionalismo", "detail": "", "weight": null},
          {"name": "conexion_personal", "detail": "Generó confianza y conexión antes de hablar de negocio", "weight": null},
          {"name": "comentarios_propiedad", "detail": "Hizo comentarios positivos sobre la propiedad", "weight": null}
        ]
      },
      {
        "name": "Validación de Propiedad",
        "max_score": 25,
        "prompt_base": "¿Recorrió la propiedad completa? ¿Preguntó por estado de escrituras, gravámenes, adeudos de servicios? ¿Evaluó condición física y necesidad de mejoras? ¿Tomó fotos y medidas? ¿Validó los datos del crédito mencionados en la llamada previa?",
        "criteria": [
          {"name": "recorrido_completo", "detail": "Recorrió la propiedad completa", "weight": null},
          {"name": "estado_legal", "detail": "Preguntó por escrituras, gravámenes, adeudos", "weight": null},
          {"name": "condicion_fisica", "detail": "Evaluó condición física y necesidad de mejoras", "weight": null},
          {"name": "fotos_medidas", "detail": "Tomó fotos y medidas", "weight": null},
          {"name": "validacion_credito", "detail": "Validó datos del crédito de llamada previa", "weight": null}
        ]
      },
      {
        "name": "Presentación Estrategia de Venta",
        "max_score": 25,
        "prompt_base": "¿Presentó un plan de comercialización claro? ¿Mostró comparables de la zona? ¿Explicó el pricing strategy con datos? ¿Describió canales de publicación (portales, redes, base de compradores)? ¿Proyectó tiempos realistas de venta?",
        "criteria": [
          {"name": "plan_comercializacion", "detail": "Presentó plan de comercialización claro", "weight": null},
          {"name": "comparables", "detail": "Mostró comparables de la zona", "weight": null},
          {"name": "pricing_strategy", "detail": "Explicó pricing strategy con datos", "weight": null},
          {"name": "canales_publicacion", "detail": "Portales, redes sociales, base de compradores", "weight": null},
          {"name": "tiempos_realistas", "detail": "Proyectó tiempos realistas de venta", "weight": null}
        ]
      },
      {
        "name": "Manejo de Objeciones del Propietario",
        "max_score": 25,
        "prompt_base": "Cada objeción que surgió y cómo respondió. Objeciones típicas: precio de lista vs expectativa, comisión, exclusiva vs abierta, déjame pensarlo, otra agencia me cobra menos. ¿Respondió con datos o con presión?",
        "criteria": [
          {"name": "precio_vs_expectativa", "detail": "", "weight": null},
          {"name": "comision", "detail": "", "weight": null},
          {"name": "exclusiva_vs_abierta", "detail": "", "weight": null},
          {"name": "dejame_pensarlo", "detail": "", "weight": null},
          {"name": "otra_agencia", "detail": "", "weight": null}
        ]
      },
      {
        "name": "Cierre de Exclusiva",
        "max_score": 15,
        "prompt_base": "¿Pidió la firma del contrato de exclusiva? ¿Presentó los beneficios de la exclusiva vs abierta? ¿Propuso un periodo de exclusiva definido? Si no cerró, ¿dejó un siguiente paso concreto con fecha?",
        "criteria": [
          {"name": "pidio_firma", "detail": "Pidió la firma del contrato de exclusiva", "weight": null},
          {"name": "beneficios_exclusiva", "detail": "Presentó beneficios de exclusiva vs abierta", "weight": null},
          {"name": "periodo_definido", "detail": "Propuso periodo de exclusiva definido", "weight": null},
          {"name": "siguiente_paso", "detail": "Si no cerró, dejó paso concreto con fecha", "weight": null}
        ]
      }
    ],
    "output_blocks": [
      {"key": "score", "description": "Score general 0-100", "format_instruction": "SCORE GENERAL: [0-100] Clasificación: [excelente/buena/regular/deficiente]"},
      {"key": "diagnostico_fases", "description": "Evaluación por fase con puntaje", "format_instruction": "Cada fase con ([puntaje]/max): [evaluación con citas específicas de la transcripción]"},
      {"key": "objeciones", "description": "Objeciones detectadas", "format_instruction": "Por cada: Objeción + Respuesta captadora + Evaluación (funcionó/no/podría mejorar) + Respuesta recomendada"},
      {"key": "siguiente_paso", "description": "Siguiente paso con el prospecto", "format_instruction": "Estado del lead (converted/lost_captadora/lost_external/pending) + Razonamiento + Acción concreta 24-48h + Mensaje WhatsApp 3 líneas"},
      {"key": "patron_error", "description": "Patrón de error principal", "format_instruction": "3-4 oraciones sobre error más estructural. Tono coach, no crítico. Específico, no genérico."}
    ],
    "tone": "Coach experimentado, directo y específico. No crítico. Citar momentos específicos. Dar recomendación accionable por cada brecha."
  }'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

-- v1 — Financiero/Crédito
INSERT INTO scorecard_templates (id, name, vertical_slug, description, structure, default_vocabulary, default_categories)
VALUES (
  'c0000000-0000-0000-0000-000000000003',
  'Financiero / Crédito',
  'financiero',
  'Evaluación de conversaciones de venta de productos financieros: crédito, factoraje, leasing, crédito pyme.',
  '{
    "objective": "Evaluar conversaciones de venta de productos financieros: crédito para empresas, factoraje, leasing, crédito pyme.",
    "context": "Objeciones comunes: buró de crédito, tasa de interés, comparación con bancos, consultar con socios. Cuello de botella: falta de intento de cierre y descubrimiento superficial.",
    "phases": [
      {
        "name": "Apertura y Control",
        "max_score": 15,
        "prompt_base": "¿Se presentó correctamente? ¿Estableció el control de la conversación desde el inicio?",
        "criteria": [
          {"name": "presentacion", "detail": "", "weight": null},
          {"name": "control_conversacion", "detail": "", "weight": null}
        ]
      },
      {
        "name": "Descubrimiento de Necesidades",
        "max_score": 25,
        "prompt_base": "¿Qué preguntas hizo y cuáles faltaron para entender la necesidad del prospecto?",
        "criteria": [
          {"name": "preguntas_realizadas", "detail": "", "weight": null},
          {"name": "preguntas_faltantes", "detail": "", "weight": null}
        ]
      },
      {
        "name": "Manejo de Objeciones",
        "max_score": 25,
        "prompt_base": "Cada objeción que apareció y cómo respondió. Incluir respuesta recomendada si falló.",
        "criteria": [
          {"name": "deteccion", "detail": "Cada objeción que apareció en la conversación", "weight": null},
          {"name": "respuesta", "detail": "Cómo respondió el vendedor", "weight": null},
          {"name": "recomendacion", "detail": "Respuesta recomendada si la respuesta falló", "weight": null}
        ]
      },
      {
        "name": "Intento de Cierre",
        "max_score": 25,
        "prompt_base": "¿Intentó cerrar? ¿Cómo? ¿Qué quedó pendiente? Si no cerró, ¿qué debería haber dicho?",
        "criteria": [
          {"name": "intento", "detail": "¿Intentó cerrar la venta?", "weight": null},
          {"name": "tecnica", "detail": "¿Qué técnica de cierre usó?", "weight": null},
          {"name": "resultado", "detail": "¿Qué quedó pendiente?", "weight": null},
          {"name": "alternativa", "detail": "Si no cerró, qué debería haber dicho", "weight": null}
        ]
      },
      {
        "name": "Señales del Prospecto y Adaptación",
        "max_score": 10,
        "prompt_base": "¿Leyó bien el estado emocional y disposición del prospecto? ¿Adaptó su enfoque?",
        "criteria": [
          {"name": "lectura_estado", "detail": "", "weight": null}
        ]
      }
    ],
    "output_blocks": [
      {"key": "score", "description": "Score general 0-100", "format_instruction": "SCORE GENERAL: [0-100] Clasificación: [excelente/buena/regular/deficiente]"},
      {"key": "diagnostico_fases", "description": "Evaluación por fase con puntaje", "format_instruction": "Cada fase con ([puntaje]/max): [evaluación con citas específicas de la transcripción]"},
      {"key": "objeciones", "description": "Objeciones detectadas", "format_instruction": "Por cada: Objeción + Respuesta vendedor + Evaluación (funcionó/no/podría mejorar) + Respuesta recomendada"},
      {"key": "siguiente_paso", "description": "Siguiente paso con el prospecto", "format_instruction": "Estado del lead (converted/lost_captadora/lost_external/pending) + Razonamiento + Acción concreta 24-48h + Mensaje WhatsApp/email 3 líneas"},
      {"key": "patron_error", "description": "Patrón de error principal", "format_instruction": "3-4 oraciones sobre error más estructural. Tono coach, no crítico. Específico, no genérico."}
    ],
    "tone": "Coach experimentado, directo y específico. No crítico. Citar momentos específicos. Dar recomendación accionable por cada brecha."
  }'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

-- =============================================================
-- 5. Clone scorecards to per-org instances
-- =============================================================

-- V5A → Inmobili (a0...001)
INSERT INTO scorecards (id, organization_id, name, version, vertical, phases, prompt_template, active, template_id, structure)
SELECT
  gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001',
  t.name,
  'V5A',
  'inmobiliario',
  (SELECT phases FROM scorecards WHERE id = 'b0000000-0000-0000-0000-000000000001'),
  (SELECT prompt_template FROM scorecards WHERE id = 'b0000000-0000-0000-0000-000000000001'),
  true,
  t.id,
  t.structure
FROM scorecard_templates t
WHERE t.id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

-- v1 → EnPagos (a0...002)
INSERT INTO scorecards (id, organization_id, name, version, vertical, phases, prompt_template, active, template_id, structure)
SELECT
  gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000002',
  t.name,
  'v1',
  'financiero',
  (SELECT phases FROM scorecards WHERE id = 'b0000000-0000-0000-0000-000000000003'),
  (SELECT prompt_template FROM scorecards WHERE id = 'b0000000-0000-0000-0000-000000000003'),
  true,
  t.id,
  t.structure
FROM scorecard_templates t
WHERE t.id = 'c0000000-0000-0000-0000-000000000003'
ON CONFLICT DO NOTHING;

-- NOTE: V5B template (c0...002) NOT cloned — available for future use.
-- NOTE: Global scorecards (b0...001/002/003) left intact as legacy.
--       Historical analyses.scorecard_id FKs remain valid.
