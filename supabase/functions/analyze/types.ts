export interface BackgroundJob {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  status: string;
  priority: number;
  payload: JobPayload;
  result: Record<string, unknown> | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  quota_consumed: boolean;
  processing_worker_id: string | null;
}

export interface JobPayload {
  transcription_text: string;
  transcription_original?: string | null;
  transcription_edited?: string | null;
  edit_percentage?: number;
  scorecard_id: string;
  funnel_stage_id?: string | null;
  fuente_lead_id?: string | null;
  avanzo_a_siguiente_etapa?: string;
  prospect_identifier?: string | null;
  prospect_phone?: string | null;
  call_notes?: string | null;
  has_audio?: boolean;
  audio_storage_path?: string | null;
  pause_count?: number;
  total_paused_seconds?: number;
}

export interface Scorecard {
  id: string;
  organization_id: string | null;
  name: string;
  version: string;
  vertical: string;
  phases: ScorecardPhase[] | null;
  prompt_template: string;
  template_id: string | null;
  structure: ScorecardStructure | null;
}

export interface ScorecardStructure {
  objective?: string;
  context?: string;
  tone?: string;
  phases?: StructurePhase[];
  output_blocks?: OutputBlock[];
  checklist_fields?: { slug: string; label: string }[];
  prospect_fields?: { key: string; instruction: string; maps_to: string; column?: string }[];
  extraction_patterns?: { key: string; regex: string; column: string }[];
}

export interface StructurePhase {
  name: string;
  max_score: number;
  prompt_base?: string;
  criteria?: { name: string; detail: string; weight?: number }[];
  fields?: string[];
}

export interface OutputBlock {
  key: string;
  description: string;
  format_instruction: string;
}

export interface ScorecardPhase {
  phase_id: string;
  phase_name: string;
  score_max: number;
  // F48b: true = la fase solo es puntuable si el prospecto es viable, así que
  // NO entra al score de desempeño de un descarte. La AUSENCIA del key
  // significa fase pura (se evalúa siempre) — no hay `lead_dependent: false`
  // en el catálogo de prod y este código no lo exige.
  lead_dependent?: boolean;
}

export interface ParsedOutput {
  score_general: number | null;
  clasificacion: string | null;
  momento_critico: string | null;
  patron_error: string | null;
  objecion_principal: string | null;
  siguiente_accion: string | null;
  lead_status: string | null;
  lead_quality: string | null;
  lead_outcome: string | null;
  // F46: bloque ESTADO DEL LEAD crudo (grupo estadoBlock[1]), null si el header
  // no matcheó. Solo se consume en el diagnóstico de partial_extraction.
  raw_estado_block: string | null;
  // F47: null = el bloque DESCALIFICACION no se pudo leer (≠ [] sin causal).
  descalificacion: string[] | null;
  // F48b: los 4 criterios del bloque EVALUACION DE DESCARTE. null = bloque
  // ausente o incompleto (parcial NO se rellena con ceros).
  descarte: DescarteScores | null;
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  business_type: string | null;
  equipment_type: string | null;
  vehicle_interest: string | null;
  financing_type: string | null;
  sale_reason: string | null;
  detected_stage_name: string | null;
  prospect_phone: string | null;
  checklist_results: { field: string; covered: boolean }[] | null;
  highlights: { type: string; snippet: string; description: string }[];
  phases: { phase_name: string; score: number; score_max: number }[];
  // F47: labels de extracción cuyo regex NO matcheó en el output. El caller
  // los filtra contra el systemPrompt (filterExpectedMisses) antes del
  // detector — un pattern que el prompt nunca pidió no cuenta como pérdida.
  extraction_label_misses: { key: string; column: string }[];
  // Persistencia: columns declaradas en extraction_patterns que NO están en
  // EXTRACTION_WRITABLE_COLUMNS — config inválida del scorecard, se ignoran
  // en el data path y disparan la alerta extraction_config_invalid.
  unsupported_extraction_columns: string[];
}

// F48b: los 4 criterios del bloque EVALUACION DE DESCARTE, cada uno 0-5
// (20 puntos máximos). Solo se emiten cuando el modelo concluye descarte.
export interface DescarteScores {
  causal_confirmada: number;
  resolubilidad_explorada: number;
  orientacion_correcta: number;
  puerta_abierta: number;
}

export interface MatchedPhase {
  phase_id: string | null;
  phase_name: string;
  score: number;
  score_max: number;
}

export interface DescalCategory {
  code: string;
  label: string;
}

export interface FunnelStage {
  id: string;
  name: string;
  scorecard_id: string | null;
}
