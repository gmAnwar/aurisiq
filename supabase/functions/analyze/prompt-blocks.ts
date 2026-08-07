// Bloques de prompt PUROS (sin I/O ni env) compartidos entre buildFullPrompt
// (claude.ts) y buildFragmentPrompt (fragment.ts). Viven separados de claude.ts
// porque claude.ts importa _shared/env.ts (Deno.env en import) y la suite corre
// solo con --allow-read — un test que importe claude.ts truena por permisos.
// Fuente única: NO copiar estos strings de vuelta a claude.ts.
import type { DescalCategory } from "./types.ts";

/**
 * System prompt addendum that instructs the LLM when to call the rejection
 * tool vs produce normal prose analysis. Appended globally to every
 * scorecard prompt (org-agnostic). Critical: distinguishes audio-level
 * rejection (call the tool) from lead-level rejection during a valid
 * conversation (normal analysis with low score / descalificación array).
 */
export const REJECTION_INSTRUCTION_BLOCK = `

---

## CRITERIO DE RECHAZO DEL AUDIO

Si la transcripción NO permite analizar la llamada como conversación de captación o venta válida, llama la tool \`report_audio_not_analyzable\` con el reason apropiado. Casos:

- \`audio_sin_habla\`: silencio o ruido sin voz audible
- \`no_es_conversacion_de_venta\`: hay habla pero no es llamada de captación/venta (ej. nota personal, podcast, explicación de uso de herramientas, conversación interna)
- \`idioma_no_soportado\`: la conversación no está en español
- \`otro\`: caso fuera de los anteriores. Incluir \`details_es_mx\` con descripción breve en español MX

CRÍTICO — NO llamar la tool en estos casos (son análisis NORMAL):
- Llamada donde el prospecto fue rechazado, descalificado, o no calificó por crédito/perfil/disponibilidad
- Llamada donde el prospecto colgó, perdió interés, o se cortó por mala señal
- Llamada donde el agente cometió errores o el cliente fue grosero
- Cualquier conversación de venta válida con resultado negativo

El criterio es: ¿el AUDIO es analizable como conversación de venta? Si SÍ → produce análisis normal (con SCORE GENERAL, fases, etc.). Si NO (audio inválido como insumo) → llama la tool.`;

export const PROSPECT_BLOCK_LEGACY: Record<string, string> = {
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

// Bloque DESCALIFICACION (catálogo por org). Devuelve "" sin catálogo — los
// callers concatenan sin condicional. Mismos labels en ambos paths → mismo parser.
export function buildDescalBlock(descalCats: DescalCategory[]): string {
  if (descalCats.length === 0) return "";
  const catList = descalCats.map(c => `- ${c.code}: ${c.label}`).join("\n");
  return `\n\n---\nDESCALIFICACION DE LEADS\nAnaliza la transcripción y determina si el lead fue descalificado. Usa SOLO los siguientes códigos del catálogo de la organización:\n${catList}\n\nAl final de tu respuesta, incluye una línea con el formato:\nDESCALIFICACION: ["codigo1", "codigo2", "codigo3"]\nSi el lead calificó (no hay razón de descalificación), escribe:\nDESCALIFICACION: []\nMáximo 3 códigos. Usa SOLO códigos del catálogo anterior.\n\nINSTRUCCION CRITICA: Si la llamada menciona MULTIPLES razones de descalificación concurrentes, DEBES devolver TODAS las que apliquen hasta un máximo de 3. NO filtres. NO priorices. NO te limites a 2.\n\nEjemplo real:\nSi el propietario dice: "la propiedad está en intestamentario con mis hermanos, no tenemos escrituras todavía, y está en Tepatitlán Jalisco"\nOutput correcto: DESCALIFICACION: ["juridico", "sin_escrituras", "fuera_de_zona"]\nOutput INCORRECTO (solo 2): DESCALIFICACION: ["juridico", "fuera_de_zona"]\n\nDevolver siempre TODAS las categorías que el prospecto mencione, no solo las más severas.`;
}
