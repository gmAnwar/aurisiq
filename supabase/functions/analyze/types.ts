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
  descalificacion: string[];
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  business_type: string | null;
  equipment_type: string | null;
  sale_reason: string | null;
  detected_stage_name: string | null;
  prospect_phone: string | null;
  checklist_results: { field: string; covered: boolean }[] | null;
  highlights: { type: string; snippet: string; description: string }[];
  phases: { phase_name: string; score: number; score_max: number }[];
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
