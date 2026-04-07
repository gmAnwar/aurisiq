/**
 * Sample data shown in C1 (Mi Día) when a user has 0 real analyses.
 * Picked by organization slug. NOT persisted to Supabase — frontend only.
 *
 * Sample IDs use the prefix `sample-` so they can never collide with real
 * UUIDs and any click-through to /analisis/[id] can be detected and bounced.
 */

export interface SampleAnalysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  fuente_lead_id: string | null;
  patron_error: string | null;
  siguiente_accion: string | null;
  categoria_descalificacion: string[] | null;
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  manager_note: string | null;
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

// Inmobili / real estate (slug = 'immobili' or vertical = 'inmobiliario')
const INMOBILIARIO: SampleAnalysis[] = [
  {
    id: "sample-inmobili-1",
    score_general: 82,
    clasificacion: "excelente",
    created_at: hoursAgo(2),
    fuente_lead_id: null,
    patron_error: "Faltó cerrar con fecha y hora concreta para la visita.",
    siguiente_accion: "Confirmar visita el sábado 10am por WhatsApp.",
    categoria_descalificacion: null,
    prospect_name: "María González",
    prospect_zone: "Las Quintas",
    property_type: "Casa",
    manager_note: null,
  },
  {
    id: "sample-inmobili-2",
    score_general: 64,
    clasificacion: "buena",
    created_at: hoursAgo(5),
    fuente_lead_id: null,
    patron_error: "No se preguntó por el motivo de venta — clave para captación.",
    siguiente_accion: "Llamar mañana a las 11am para profundizar.",
    categoria_descalificacion: null,
    prospect_name: "Roberto Martínez",
    prospect_zone: "Lomas del Valle",
    property_type: "Departamento",
    manager_note: null,
  },
  {
    id: "sample-inmobili-3",
    score_general: 38,
    clasificacion: "deficiente",
    created_at: hoursAgo(8),
    fuente_lead_id: null,
    patron_error: "Prospecto fuera de zona de cobertura.",
    siguiente_accion: "Descalificar y archivar.",
    categoria_descalificacion: ["fuera_de_zona"],
    prospect_name: "Lucía Hernández",
    prospect_zone: "Saltillo",
    property_type: "Casa",
    manager_note: null,
  },
];

// EnPagos / financial (slug = 'enpagos' or vertical = 'financiero')
const FINANCIERO: SampleAnalysis[] = [
  {
    id: "sample-enpagos-1",
    score_general: 78,
    clasificacion: "excelente",
    created_at: hoursAgo(2),
    fuente_lead_id: null,
    patron_error: "Faltó verificar buró antes de pasar a la siguiente etapa.",
    siguiente_accion: "Agendar visita de verificación esta semana.",
    categoria_descalificacion: null,
    prospect_name: "Carmen Ortiz",
    prospect_zone: "Tienda de abarrotes",
    property_type: "Crédito $30k",
    manager_note: null,
  },
  {
    id: "sample-enpagos-2",
    score_general: 71,
    clasificacion: "buena",
    created_at: hoursAgo(4),
    fuente_lead_id: null,
    patron_error: "No se preguntó por antigüedad del negocio.",
    siguiente_accion: "Segunda llamada para precalificación completa.",
    categoria_descalificacion: null,
    prospect_name: "Jorge Ramírez",
    prospect_zone: "Tortillería",
    property_type: "Crédito $50k",
    manager_note: null,
  },
  {
    id: "sample-enpagos-3",
    score_general: 42,
    clasificacion: "deficiente",
    created_at: hoursAgo(6),
    fuente_lead_id: null,
    patron_error: "Prospecto sin negocio establecido — no califica.",
    siguiente_accion: "Descalificar.",
    categoria_descalificacion: ["sin_negocio_establecido"],
    prospect_name: "Pedro Ruiz",
    prospect_zone: "Ambulante",
    property_type: "Crédito $20k",
    manager_note: null,
  },
];

// Generic sales fallback
const GENERICO: SampleAnalysis[] = [
  {
    id: "sample-gen-1",
    score_general: 75,
    clasificacion: "excelente",
    created_at: hoursAgo(2),
    fuente_lead_id: null,
    patron_error: "Faltó cierre claro al final de la llamada.",
    siguiente_accion: "Hacer seguimiento mañana en la mañana.",
    categoria_descalificacion: null,
    prospect_name: "Cliente Demo 1",
    prospect_zone: null,
    property_type: null,
    manager_note: null,
  },
  {
    id: "sample-gen-2",
    score_general: 60,
    clasificacion: "buena",
    created_at: hoursAgo(5),
    fuente_lead_id: null,
    patron_error: "No se exploraron necesidades a fondo.",
    siguiente_accion: "Segunda llamada con preguntas abiertas.",
    categoria_descalificacion: null,
    prospect_name: "Cliente Demo 2",
    prospect_zone: null,
    property_type: null,
    manager_note: null,
  },
  {
    id: "sample-gen-3",
    score_general: 40,
    clasificacion: "deficiente",
    created_at: hoursAgo(8),
    fuente_lead_id: null,
    patron_error: "Prospecto no califica.",
    siguiente_accion: "Descalificar y archivar.",
    categoria_descalificacion: ["no_califica"],
    prospect_name: "Cliente Demo 3",
    prospect_zone: null,
    property_type: null,
    manager_note: null,
  },
];

export function getSampleAnalyses(orgSlug: string | null | undefined): SampleAnalysis[] {
  if (orgSlug === "immobili" || orgSlug === "inmobili") return INMOBILIARIO;
  if (orgSlug === "enpagos") return FINANCIERO;
  return GENERICO;
}

export function isSampleId(id: string): boolean {
  return id.startsWith("sample-");
}
