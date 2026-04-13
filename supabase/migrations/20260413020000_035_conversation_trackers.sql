-- 035: conversation_trackers — Gong-style highlight categories
-- Universal trackers (organization_id IS NULL) + per-org custom trackers

CREATE TABLE IF NOT EXISTS conversation_trackers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('prospect', 'seller', 'any')),
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraints via partial indexes (NULLS DISTINCT issue)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trackers_global_code
  ON conversation_trackers (code) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trackers_org_code
  ON conversation_trackers (organization_id, code) WHERE organization_id IS NOT NULL;

-- Query index
CREATE INDEX IF NOT EXISTS idx_trackers_org_active
  ON conversation_trackers (organization_id, active, sort_order);

-- RLS
ALTER TABLE conversation_trackers ENABLE ROW LEVEL SECURITY;

-- SELECT: universal visible to all, custom visible to own org
DROP POLICY IF EXISTS "conversation_trackers_select" ON conversation_trackers;
CREATE POLICY "conversation_trackers_select" ON conversation_trackers
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- INSERT/UPDATE/DELETE: only super_admin
DROP POLICY IF EXISTS "conversation_trackers_insert" ON conversation_trackers;
CREATE POLICY "conversation_trackers_insert" ON conversation_trackers
  FOR INSERT WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "conversation_trackers_update" ON conversation_trackers;
CREATE POLICY "conversation_trackers_update" ON conversation_trackers
  FOR UPDATE USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "conversation_trackers_delete" ON conversation_trackers;
CREATE POLICY "conversation_trackers_delete" ON conversation_trackers
  FOR DELETE USING (get_user_role() = 'super_admin');

-- ─── Seed: 10 universal trackers ───────────────────────────
INSERT INTO conversation_trackers (organization_id, code, label, icon, description, speaker, sort_order)
VALUES
  (NULL, 'motivacion',      'Motivación',                    '🎯', 'Razón por la que el prospecto quiere hacer la transacción. Buscar motivación real, no superficial.', 'prospect', 1),
  (NULL, 'presupuesto',     'Presupuesto y precio',          '💰', 'Capacidad económica del prospecto, menciones de precio, expectativas de costo.', 'prospect', 2),
  (NULL, 'objeciones',      'Objeciones',                    '🚫', 'Bloqueos explícitos del prospecto: razones para no avanzar, dudas, resistencias.', 'prospect', 3),
  (NULL, 'timing',          'Tiempos y urgencia',            '⏰', 'Plazos mencionados, cuándo necesita decidir, urgencia percibida.', 'prospect', 4),
  (NULL, 'decisores',       'Decisores',                     '👥', 'Quién toma la decisión, stakeholders involucrados, influenciadores.', 'any', 5),
  (NULL, 'competencia',     'Competencia y alternativas',    '🏢', 'Menciones a otras opciones, comparaciones, alternativas que el prospecto está considerando.', 'prospect', 6),
  (NULL, 'proximos_pasos',  'Próximos pasos',                '➡️', 'Acuerdos sobre siguiente contacto, visita, envío de documentos, siguiente acción concreta.', 'any', 7),
  (NULL, 'compromisos',     'Compromisos del prospecto',     '✅', 'Lo que el prospecto acepta hacer: enviar documentos, agendar visita, consultar con alguien.', 'prospect', 8),
  (NULL, 'preguntas',       'Preguntas del prospecto',       '❓', 'Dudas y preguntas que revelan interés genuino o preocupaciones específicas.', 'prospect', 9),
  (NULL, 'coaching',        'Momentos de coaching',          '💡', 'Fragmentos donde el vendedor hizo algo notable (positivo o negativo) que cambió el rumbo.', 'seller', 10)
ON CONFLICT DO NOTHING;

-- ─── Seed: Inmobili custom trackers ────────────────────────
INSERT INTO conversation_trackers (organization_id, code, label, icon, description, speaker, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'infonavit',           'Infonavit / crédito',        '🏦', 'Menciones a crédito Infonavit, hipotecario, NSS, número de crédito, subcuenta.', 'any', 1),
  ('a0000000-0000-0000-0000-000000000001', 'documentacion',       'Documentación',              '📄', 'Escrituras, INE, estado civil, actas, poderes notariales, papelería en orden.', 'any', 2),
  ('a0000000-0000-0000-0000-000000000001', 'zona',                'Zona / ubicación',           '📍', 'Colonia, municipio, zona geográfica de la propiedad, accesibilidad.', 'any', 3),
  ('a0000000-0000-0000-0000-000000000001', 'adeudos_servicios',   'Adeudos de servicios',       '🔌', 'Adeudos de CFE, predial, agua, servicios a nombre de quién.', 'any', 4)
ON CONFLICT DO NOTHING;

-- ─── Seed: EnPagos custom trackers ─────────────────────────
INSERT INTO conversation_trackers (organization_id, code, label, icon, description, speaker, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000002', 'tipo_equipo',         'Tipo de equipo',             '🛠️', 'Tipo de equipo que necesita financiar: horno, vitrina, refrigerador, máquina.', 'any', 1),
  ('a0000000-0000-0000-0000-000000000002', 'antiguedad_negocio',  'Antigüedad del negocio',     '🏪', 'Cuánto tiempo lleva operando el negocio, estabilidad del negocio.', 'any', 2),
  ('a0000000-0000-0000-0000-000000000002', 'historial_credito',   'Historial crediticio',       '📊', 'Historial de créditos previos, buró de crédito, pagos a tiempo.', 'any', 3),
  ('a0000000-0000-0000-0000-000000000002', 'enganche',            'Enganche disponible',        '💵', 'Monto de enganche que puede dar, capacidad de pago inicial.', 'prospect', 4)
ON CONFLICT DO NOTHING;
