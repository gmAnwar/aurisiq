-- 037: stage_checklist_items — configurable checklist per funnel stage
-- Replaces hardcoded checklist in Worker/Edge Function prompt

CREATE TABLE IF NOT EXISTS stage_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_stage_id UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: no duplicate labels per stage
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_items_unique
  ON stage_checklist_items (funnel_stage_id, label) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_checklist_items_stage
  ON stage_checklist_items (funnel_stage_id, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_checklist_items_org
  ON stage_checklist_items (organization_id);

-- RLS
ALTER TABLE stage_checklist_items ENABLE ROW LEVEL SECURITY;

-- SELECT: users of the org or super_admin
DROP POLICY IF EXISTS "stage_checklist_items_select" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_select" ON stage_checklist_items
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- INSERT: gerente/direccion of the org or super_admin
DROP POLICY IF EXISTS "stage_checklist_items_insert" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_insert" ON stage_checklist_items
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );

-- UPDATE: gerente/direccion of the org or super_admin
DROP POLICY IF EXISTS "stage_checklist_items_update" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_update" ON stage_checklist_items
  FOR UPDATE USING (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );

-- DELETE: gerente/direccion of the org or super_admin
DROP POLICY IF EXISTS "stage_checklist_items_delete" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_delete" ON stage_checklist_items
  FOR DELETE USING (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );

-- ─── Seed: 26 items for Inmobili "Llamada 1 de Captacion" ──

INSERT INTO stage_checklist_items (funnel_stage_id, organization_id, label, description, sort_order)
SELECT fs.id, fs.organization_id, v.label, v.description, v.sort_order
FROM funnel_stages fs
CROSS JOIN (VALUES
  ('Nombre completo',              'Nombre y apellidos del propietario o titular del crédito',                      1),
  ('Dirección de la propiedad',    'Calle, número, colonia, municipio de la propiedad en venta',                    2),
  ('Libre de gravamen',            'Si la propiedad está libre de gravamen o tiene crédito hipotecario vigente',    3),
  ('Pagos puntuales',              'Si el titular tiene sus pagos al corriente (Infonavit/banco)',                  4),
  ('Adeudos en tiempo consecutivo','Meses consecutivos de adeudo en el crédito hipotecario',                        5),
  ('Crédito individual o conyugal','Si el crédito es individual o mancomunado con cónyuge',                         6),
  ('NSS',                          'Número de Seguridad Social del titular — 11 dígitos',                           7),
  ('NC',                           'Número de Crédito Infonavit del titular',                                       8),
  ('Estado civil',                 'Casado, soltero, unión libre — relevante para escrituración',                   9),
  ('Papelería/escrituras',         'Si tiene escrituras en orden, actas, poderes notariales',                       10),
  ('Dirección INE',                'Dirección registrada en la identificación oficial (INE)',                        11),
  ('Descripción del domicilio',    'Tipo de propiedad, recámaras, baños, metros, nivel, condición general',         12),
  ('Casa habitada o desocupada',   'Si la propiedad está actualmente habitada o desocupada',                        13),
  ('Motivo de venta',              'Razón por la que el propietario quiere vender',                                 14),
  ('Servicios a nombre de quién',  'Titular de los servicios (CFE, agua, gas) — puede diferir del propietario',     15),
  ('Adeudos de servicios',         'Si hay adeudos pendientes de CFE, predial, agua u otros servicios',             16),
  ('Financiamiento de adeudos',    'Si los adeudos de servicios se pueden financiar o liquidar antes del cierre',   17),
  ('Expectativa del cliente',      'Precio que el propietario espera recibir por la venta',                         18),
  ('Disponibilidad para visita',   'Si el propietario está dispuesto a recibir visita de captación',                19),
  ('Precio estimado de venta',     'Precio de mercado estimado según comparables de la zona',                       20),
  ('Precio estimado de captación', 'Precio al que la inmobiliaria captaría la propiedad',                           21),
  ('Fecha y hora propuesta',       'Fecha y hora concreta propuesta para la visita presencial',                     22),
  ('Lectura de disposición',       'Qué tan dispuesto está el prospecto a avanzar con la venta',                    23),
  ('Lectura de resistencia',       'Objeciones o resistencias detectadas durante la llamada',                       24),
  ('Lectura de urgencia',          'Qué tan urgente es la venta para el propietario',                               25),
  ('Promesa de venta',             'Si el prospecto dio compromiso verbal de avanzar con la captación',             26)
) AS v(label, description, sort_order)
WHERE fs.organization_id = 'a0000000-0000-0000-0000-000000000001'
  AND fs.name = 'Llamada 1 de Captacion'
ON CONFLICT DO NOTHING;
