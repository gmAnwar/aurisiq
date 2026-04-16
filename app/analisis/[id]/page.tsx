"use client";

import { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { stripJson } from "../../../lib/text";
import EditableField from "../../components/EditableName";
import TranscriptEditor from "../../components/TranscriptEditor";
import { isFinanciero } from "../../../lib/verticals";

interface Phase {
  phase_name: string;
  score: number;
  score_max: number;
}

interface ChecklistItem {
  field: string;
  covered?: boolean;
  state?: "covered" | "asked_no_answer" | "not_covered";
}

interface Analysis {
  id: string;
  scorecard_id?: string | null;
  score_general: number | null;
  clasificacion: string | null;
  momento_critico: string | null;
  patron_error: string | null;
  objecion_principal: string | null;
  siguiente_accion: string | null;
  categoria_descalificacion: string[] | null;
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  business_type: string | null;
  equipment_type: string | null;
  vehicle_interest: string | null;
  financing_type: string | null;
  sale_reason: string | null;
  prospect_phone: string | null;
  checklist_results: ChecklistItem[] | null;
  manager_note: string | null;
  notes: string | null;
  lead_estado: string | null;
  lead_quality: string | null;
  lead_outcome: string | null;
  related_analysis_id: string | null;
  legacy_note: string | null;
  highlights: { category_code: string; snippet: string; speaker: string; description: string }[] | null;
  created_at: string;
}

interface RelatedCall {
  id: string;
  score_general: number | null;
  created_at: string;
  funnel_stage_id: string | null;
}

export default function ResultadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [descalLabels, setDescalLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [relatedCalls, setRelatedCalls] = useState<RelatedCall[]>([]);
  const [vertical, setVertical] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcriptionOriginal, setTranscriptionOriginal] = useState<string | null>(null);
  const [editPercentage, setEditPercentage] = useState(0);
  const [userId, setUserId] = useState("");
  const [trackers, setTrackers] = useState<{ code: string; label: string; icon: string }[]>([]);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setUserId(session.userId);

      // super_admin may be viewing an analysis from an org different
      // from their profile org (admin_active_org_id). RLS would hide
      // it, so route through the service-role endpoint instead.
      if (session.realRoles.includes("super_admin")) {
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          const token = s?.access_token;
          const res = await fetch(`/api/admin/analysis/${id}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const body = await res.json();
          if (!res.ok) {
            setError(body.error === "Not found" ? "No se encontró este análisis." : (body.error || "Error cargando análisis"));
            setLoading(false);
            return;
          }
          // If the analysis belongs to a different org than the active
          // one (user just switched orgs in the navbar), redirect to the
          // list instead of showing stale cross-org data.
          if (body.analysis?.organization_id && body.analysis.organization_id !== session.organizationId) {
            router.replace("/analisis");
            return;
          }

          setAnalysis(body.analysis);
          setVertical(body.vertical || null);
          setPhases(body.phases || []);
          if (body.descal_categories) {
            const map: Record<string, string> = {};
            for (const c of body.descal_categories as { code: string; label: string }[]) {
              map[c.code] = c.label;
            }
            setDescalLabels(map);
          }
          setRelatedCalls(body.related || []);
          if (body.job) {
            setTranscription(body.job.transcription_edited || body.job.transcription_text || body.job.transcription_original || null);
            setTranscriptionOriginal(body.job.transcription_original || null);
            setEditPercentage(body.job.edit_percentage || 0);
          }
          // Fetch trackers for super_admin path
          const { data: trk } = await supabase
            .from("conversation_trackers")
            .select("code, label, icon")
            .or(`organization_id.eq.${session.organizationId},organization_id.is.null`)
            .eq("active", true)
            .order("sort_order");
          setTrackers(trk || []);
          setLoading(false);
          return;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error cargando análisis");
          setLoading(false);
          return;
        }
      }

      const { data: a, error: aErr } = await supabase
        .from("analyses")
        .select("id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, prospect_name, prospect_zone, property_type, business_type, equipment_type, vehicle_interest, financing_type, sale_reason, prospect_phone, checklist_results, manager_note, notes, lead_estado, lead_quality, lead_outcome, related_analysis_id, created_at, scorecard_id, legacy_note, highlights")
        .eq("id", id)
        .single();

      if (aErr || !a) {
        setError("No se encontró este análisis.");
        setLoading(false);
        return;
      }

      setAnalysis(a);

      if (a.scorecard_id) {
        const { data: sc } = await supabase
          .from("scorecards")
          .select("vertical")
          .eq("id", a.scorecard_id)
          .maybeSingle();
        if (sc?.vertical) setVertical(sc.vertical);
      }

      const { data: ph } = await supabase
        .from("analysis_phases")
        .select("phase_name, score, score_max")
        .eq("analysis_id", id)
        .order("created_at", { ascending: true });

      setPhases(ph || []);

      if (a.categoria_descalificacion && a.categoria_descalificacion.length > 0) {
        const { data: cats } = await supabase
          .from("descalification_categories")
          .select("code, label")
          .eq("organization_id", session.organizationId);

        const map: Record<string, string> = {};
        for (const c of cats || []) map[c.code] = c.label;
        setDescalLabels(map);
      }

      // Fetch transcription from analysis_jobs
      const { data: job } = await supabase
        .from("analysis_jobs")
        .select("transcription_text, transcription_edited, transcription_original, edit_percentage")
        .eq("analysis_id", id)
        .maybeSingle();
      if (job) {
        setTranscription(job.transcription_edited || job.transcription_text || job.transcription_original || null);
        setTranscriptionOriginal(job.transcription_original || null);
        setEditPercentage(job.edit_percentage || 0);
      }

      // Fetch related calls with same prospect
      if (a.prospect_name && a.prospect_name !== "No identificado") {
        const { data: related } = await supabase
          .from("analyses")
          .select("id, score_general, created_at, funnel_stage_id")
          .eq("organization_id", session.organizationId)
          .eq("status", "completado")
          .neq("id", id)
          .ilike("prospect_name", a.prospect_name)
          .order("created_at", { ascending: false })
          .limit(5);
        setRelatedCalls(related || []);
      }

      // Fetch trackers for grouped highlights
      const { data: trk } = await supabase
        .from("conversation_trackers")
        .select("code, label, icon")
        .or(`organization_id.eq.${session.organizationId},organization_id.is.null`)
        .eq("active", true)
        .order("sort_order");
      setTrackers(trk || []);

      setLoading(false);
    }

    load();
  }, [id]);

  const handleFieldSave = useCallback((field: string, val: string) => {
    setAnalysis(prev => prev ? { ...prev, [field]: val } : prev);
  }, []);

  if (loading) {
    return (
      <div className="container c3-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-select" />
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="container c3-container">
        <div className="message-box message-error">
          <p>{error || "Error al cargar el análisis."}</p>
        </div>
        <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 16 }}>
          Nueva llamada
        </Link>
      </div>
    );
  }

  const momento = stripJson(analysis.momento_critico) || null;
  const mejora = stripJson(analysis.patron_error) || null;
  const accion = stripJson(analysis.siguiente_accion) || null;
  const objecion = stripJson(analysis.objecion_principal) || null;

  const checklist = analysis.checklist_results || [];
  const isCovered = (c: ChecklistItem) => c.state ? c.state === "covered" : !!c.covered;
  const isPartial = (c: ChecklistItem) => c.state === "asked_no_answer";
  const covered = checklist.filter(isCovered).length;
  const partial = checklist.filter(isPartial).length;
  const total = checklist.length || 26;

  const date = new Date(analysis.created_at);
  const timeStr = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString("es-MX", { day: "numeric", month: "long" });

  // prospectMeta removed — each field is now individually editable

  return (
    <div className="container c3-container">

      {/* 0. MANAGER NOTE */}
      {analysis.manager_note && (
        <div className="c3-manager-note">
          <span className="c3-manager-note-label">Nota de tu gerente</span>
          <p className="c3-manager-note-text">{analysis.manager_note}</p>
        </div>
      )}

      {/* 1. PROSPECT CARD */}
      <div className="c3-prospect-card">
        <h1 className="c3-prospect-name">
          <EditableField analysisId={analysis.id} field="prospect_name" currentValue={analysis.prospect_name} placeholder="Sin nombre" onSave={(v) => handleFieldSave("prospect_name", v)} />
          <span style={{ fontWeight: 400, fontSize: 14, color: "var(--ink-light)" }}>
            {" · "}<EditableField analysisId={analysis.id} field="prospect_zone" currentValue={analysis.prospect_zone} placeholder="Zona" onSave={(v) => handleFieldSave("prospect_zone", v)} />
            {isFinanciero(vertical) ? (
              <>
                {" · "}<EditableField
                  analysisId={analysis.id}
                  field="business_type"
                  currentValue={analysis.business_type}
                  placeholder="Tipo de negocio"
                  onSave={(v) => handleFieldSave("business_type", v)}
                />
                {" · "}<EditableField
                  analysisId={analysis.id}
                  field="equipment_type"
                  currentValue={analysis.equipment_type}
                  placeholder="Tipo de equipo"
                  onSave={(v) => handleFieldSave("equipment_type", v)}
                />
              </>
            ) : vertical === "automotriz" ? (
              <>
                {" · "}<EditableField
                  analysisId={analysis.id}
                  field="vehicle_interest"
                  currentValue={analysis.vehicle_interest}
                  placeholder="Vehículo de interés"
                  onSave={(v) => handleFieldSave("vehicle_interest", v)}
                />
                {" · "}<EditableField
                  analysisId={analysis.id}
                  field="financing_type"
                  currentValue={analysis.financing_type}
                  placeholder="Tipo de financiamiento"
                  onSave={(v) => handleFieldSave("financing_type", v)}
                />
              </>
            ) : (
              <>
                {" · "}<EditableField
                  analysisId={analysis.id}
                  field="property_type"
                  currentValue={analysis.property_type}
                  placeholder="Tipo"
                  onSave={(v) => handleFieldSave("property_type", v)}
                />
              </>
            )}
          </span>
        </h1>
        <p className="c3-prospect-meta">{dateStr} · {timeStr}</p>
        {/* Lead estado badge — separate from score */}
        {analysis.lead_estado === "descartado" ? (
          <div className="c3-lead-badge c3-lead-descartado">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            Lead descartado
          </div>
        ) : analysis.lead_estado === "calificado" ? (
          <div className="c3-lead-badge c3-lead-calificado">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Lead calificado
          </div>
        ) : (
          <div className="c3-lead-badge c3-lead-pendiente">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Lead pendiente
          </div>
        )}
        {analysis.lead_estado === "descartado" && (analysis.categoria_descalificacion || []).length > 0 && (
          <div className="c3-descal-reasons">
            {(analysis.categoria_descalificacion || []).map((code, i) => (
              <span key={i} className="c3-descal-pill">{descalLabels[code] || code}</span>
            ))}
          </div>
        )}
        {/* Lead quality + outcome badges (new v22 fields) */}
        {(analysis.lead_quality || analysis.lead_outcome) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {analysis.lead_quality === "calificado" && <span className="c3-lead-badge c3-lead-calificado" style={{ fontSize: 12, padding: "3px 10px" }}>Lead calificado</span>}
            {analysis.lead_quality === "indeterminado" && <span className="c3-lead-badge c3-lead-pendiente" style={{ fontSize: 12, padding: "3px 10px" }}>Calidad indeterminada</span>}
            {analysis.lead_quality === "descalificado" && <span className="c3-lead-badge c3-lead-descartado" style={{ fontSize: 12, padding: "3px 10px" }}>Lead descalificado</span>}
            {analysis.lead_outcome === "cerrado_completo" && <span className="c3-lead-badge c3-lead-calificado" style={{ fontSize: 12, padding: "3px 10px" }}>Cerrado completo</span>}
            {analysis.lead_outcome === "cerrado_parcial" && <span className="c3-lead-badge c3-lead-calificado" style={{ fontSize: 12, padding: "3px 10px", background: "#d1fae5", borderColor: "#6ee7b7" }}>Cerrado parcial</span>}
            {analysis.lead_outcome === "pospuesto_con_agenda" && <span className="c3-lead-badge" style={{ fontSize: 12, padding: "3px 10px", background: "#dbeafe", color: "#1e40af", borderColor: "#93c5fd" }}>Pospuesto con agenda</span>}
            {analysis.lead_outcome === "pospuesto_sin_agenda" && <span className="c3-lead-badge c3-lead-pendiente" style={{ fontSize: 12, padding: "3px 10px" }}>Pospuesto sin agenda</span>}
            {analysis.lead_outcome === "descalificado" && <span className="c3-lead-badge" style={{ fontSize: 12, padding: "3px 10px", background: "#f3f4f6", color: "#6b7280", borderColor: "#d1d5db" }}>Descalificado</span>}
            {analysis.lead_outcome === "perdido" && <span className="c3-lead-badge c3-lead-descartado" style={{ fontSize: 12, padding: "3px 10px" }}>Perdido</span>}
          </div>
        )}
        {vertical !== "financiero" && vertical !== "automotriz" && analysis.sale_reason && analysis.sale_reason !== "No mencionado" && (
          <p className="c3-prospect-reason">Motivo de venta: {analysis.sale_reason}</p>
        )}
        <p className="c3-prospect-reason" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden="true" style={{ fontSize: 16 }}>💬</span>
          <span>WhatsApp:&nbsp;</span>
          <EditableField
            analysisId={analysis.id}
            field="prospect_phone"
            currentValue={analysis.prospect_phone}
            placeholder="Agregar WhatsApp"
            onSave={(v) => handleFieldSave("prospect_phone", v)}
          />
        </p>
        {analysis.notes && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(0,0,0,0.03)", borderRadius: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-light)" }}>Notas de llamada</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{analysis.notes}</p>
          </div>
        )}
      </div>

      {/* 1b. RELATED CALLS */}
      {relatedCalls.length > 0 && (
        <div className="c3-section">
          <p className="c3-section-label">
            Historial con {analysis.prospect_name || "este prospecto"} — esta es tu {relatedCalls.length + 1}a llamada
          </p>
          <div className="c3-related-list">
            {relatedCalls.map(r => (
              <a key={r.id} href={`/analisis/${r.id}`} className="c3-related-item">
                <span className="c3-related-date">
                  {new Date(r.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                </span>
                {r.score_general !== null && (
                  <span className="c3-related-score">{r.score_general}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 2. WHAT YOU ACHIEVED */}
      {checklist.length > 0 && (
        <div className="c3-section">
          <p className="c3-section-label">Qué lograste</p>
          <div className="c3-achievement">
            <span className="c3-achievement-count">{covered} de {total}</span>
            <span className="c3-achievement-text">datos del checklist obtenidos</span>
          </div>
          <div className="c3-achievement-bar-bg">
            <div className="c3-achievement-bar-fill" style={{ width: `${Math.round((covered / total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Descalification pills */}
      <div className="c3-section">
        {analysis.lead_estado === "descartado" && <span className="c3-pill c3-pill-red">Lead descartado</span>}
        {analysis.lead_estado === "calificado" && <span className="c3-pill c3-pill-green">Lead calificado</span>}
        {(analysis.lead_estado === "pendiente" || !analysis.lead_estado) && <span className="c3-pill c3-pill-yellow">Lead pendiente</span>}
        {analysis.lead_estado === "descartado" && (analysis.categoria_descalificacion || []).length > 0 && (
          <div className="c3-pill-list">
            {(analysis.categoria_descalificacion || []).map((code, i) => (
              <span key={i} className={`c3-pill ${i === 0 ? "c3-pill-primary" : "c3-pill-secondary"}`}>
                {descalLabels[code] || code}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Legacy analysis banner */}
      {analysis.legacy_note && (
        <div style={{ padding: "8px 12px", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, fontSize: 13, color: "#92400e", marginBottom: 12 }}>
          Este análisis fue procesado con un bug conocido previo a la corrección del 12 abr. Los resultados pueden no reflejar el scorecard correcto.
        </div>
      )}

      {/* 3. SCORE + COACHING BY PHASE */}
      {analysis.score_general !== null && (
        <div className="c3-section">
          <div className="c3-score-inline" title="El score evalúa el desempeño de la captadora, no la calidad del lead">
            <span className="c3-score-value">{analysis.score_general}</span>
            {analysis.clasificacion && (
              <span className={`c3-clasificacion c3-clas-${analysis.clasificacion}`}>
                {analysis.clasificacion}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Score reference table */}
      {analysis.score_general !== null && (
        <details className="c3-score-ref">
          <summary className="c3-score-ref-summary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            ¿Qué significa mi score?
          </summary>
          <div className="c3-score-ref-body">
            <table className="c3-score-ref-table">
              <thead><tr><th>Rango</th><th>Qué significa</th></tr></thead>
              <tbody>
                <tr><td><span className="c3-ref-range c3-ref-excelente">Excelente (81–100)</span></td><td>La llamada cubrió casi todos los puntos del scorecard con claridad. Obtuviste datos clave, manejaste objeciones con argumentos sólidos y dejaste un siguiente paso concreto. Mantén este nivel.</td></tr>
                <tr><td><span className="c3-ref-range c3-ref-buena">Buena (61–80)</span></td><td>La llamada cumplió con los puntos críticos, pero faltaron detalles en algunas fases. Hay 2–3 oportunidades claras de mejora que, si las cierras, te llevan a excelente.</td></tr>
                <tr><td><span className="c3-ref-range c3-ref-regular">Regular (41–60)</span></td><td>Cubriste lo básico pero dejaste pasar información importante (calificación incompleta, objeciones sin respuesta sólida, cierre débil). Requiere retrabajo o seguimiento para recuperar la oportunidad.</td></tr>
                <tr><td><span className="c3-ref-range c3-ref-deficiente">Deficiente (0–40)</span></td><td>La llamada no avanzó el proceso de captación. Faltaron preguntas clave, el prospecto no quedó calificado y no hay un siguiente paso claro. Revisar con el gerente qué replantear.</td></tr>
              </tbody>
            </table>
            <p className="c3-score-ref-note">Tu score mide el desempeño de tu llamada, no si el lead calificó. Un lead puede ser descartado y aun así tener un score alto si manejaste la llamada correctamente.</p>
          </div>
        </details>
      )}

      {/* Key moment + pattern cards */}
      {momento && (
        <div className="c3-card c3-card-momento">
          <div className="c3-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
          </div>
          <div>
            <span className="c3-card-title">Momento clave de la llamada</span>
            <p className="c3-card-body">{momento}</p>
          </div>
        </div>
      )}

      {mejora && (
        <div className="c3-card c3-card-patron">
          <div className="c3-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
          </div>
          <div>
            <span className="c3-card-title">Área de mejora</span>
            <p className="c3-card-body">{mejora}</p>
          </div>
        </div>
      )}

      {phases.length > 0 && (
        <div className="c3-section">
          <p className="c3-section-label">Desglose por fase</p>
          <div className="c3-phases">
            {phases.map((p, i) => {
              const pct = p.score_max > 0 ? (p.score / p.score_max) * 100 : 0;
              const color = pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--gold)" : "var(--red)";
              return (
                <div key={i} className="c3-phase-row">
                  <div className="c3-phase-header">
                    <span className="c3-phase-name">{p.phase_name}</span>
                    <span className="c3-phase-score" style={{ color }}>{p.score}/{p.score_max}</span>
                  </div>
                  <div className="c3-phase-bar-bg">
                    <div className="c3-phase-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coaching — objecion */}

      {objecion && (
        <div className="c3-section">
          <p className="c3-section-label">Objeción detectada</p>
          <p className="c3-highlight">{objecion}</p>
        </div>
      )}

      {/* 4. NEXT STEP + WHATSAPP MESSAGE */}
      {accion && (() => {
        // Parse WhatsApp message from accion text
        const msgMatch = accion.match(/[Mm]ensaje\s+sugerido\s*:\s*([\s\S]+)/);
        const actionPart = msgMatch ? accion.slice(0, msgMatch.index).trim() : accion;
        const whatsappMsg = msgMatch ? msgMatch[1].trim().replace(/^[""]|[""]$/g, "") : null;
        return (
          <div className="c3-section">
            <p className="c3-section-label">Siguiente paso con este prospecto</p>
            {actionPart && <div className="c3-next-step">{actionPart}</div>}
            {whatsappMsg && (
              <WhatsAppCard message={whatsappMsg} phone={analysis.prospect_phone} />
            )}
          </div>
        );
      })()}

      {/* 4b. TRANSCRIPTION */}
      {transcription && (
        <details className="c3-expandable">
          <summary className="c3-expand-summary">Ver transcripción de la llamada</summary>
          <TranscriptEditor
            analysisId={analysis.id}
            transcriptionText={transcription}
            transcriptionOriginal={transcriptionOriginal}
            editPercentage={editPercentage}
            showEditBadge={true}
            showEditHistory={false}
            userId={userId}
            highlights={analysis.highlights || []}
            onSaved={(newText, newPct) => { setTranscription(newText); setEditPercentage(newPct); }}
          />
        </details>
      )}

      {/* 4c. GROUPED HIGHLIGHTS */}
      {(() => {
        const grouped = trackers.reduce<{ code: string; label: string; icon: string; items: NonNullable<Analysis["highlights"]> }[]>((acc, t) => {
          const items = (analysis.highlights || []).filter(h => h.category_code === t.code);
          if (items.length > 0) acc.push({ ...t, items });
          return acc;
        }, []);
        if (grouped.length === 0 && (analysis.highlights || []).length === 0) return null;
        return (
          <div className="c3-section">
            <p className="c3-section-label">Fragmentos destacados</p>
            {grouped.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-light)" }}>No se identificaron fragmentos destacados en esta llamada.</p>
            ) : grouped.map(group => (
              <div key={group.code} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span>{group.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{group.label}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-light)" }}>({group.items.length})</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.items.map((h, i) => (
                    <div key={i} style={{
                      padding: "10px 12px",
                      borderRadius: 6,
                      borderLeft: `4px solid ${group.code === "coaching" ? "#f59e0b" : "#d1d5db"}`,
                      background: group.code === "coaching" ? "#fffbeb" : "#f9fafb",
                    }}>
                      <p style={{ margin: 0, fontSize: 13, fontStyle: "italic", lineHeight: 1.5 }}>&ldquo;{h.snippet}&rdquo;</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-light)" }}>{h.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 5. CHECKLIST VISUAL */}
      {checklist.length > 0 ? (
        <details className="c3-expandable">
          <summary className="c3-expand-summary">Ver checklist completo ({covered}{partial > 0 ? `+${partial}` : ""}/{total})</summary>
          <div className="c3-checklist">
            {checklist.map((item, i) => {
              const yes = isCovered(item);
              const maybe = isPartial(item);
              return (
                <div key={i} className={`c3-check-item ${yes ? "c3-check-yes" : maybe ? "c3-check-maybe" : "c3-check-no"}`}>
                  <span className="c3-check-icon">{yes ? "\u2713" : maybe ? "~" : "\u2717"}</span>
                  <span className="c3-check-label">{item.field}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : (
        <div style={{ padding: "10px 12px", background: "#f5f5f4", borderRadius: 6, fontSize: 13, color: "#78716c" }}>
          Esta etapa no tiene checklist configurado. Tu gerente puede configurarlo en Configuración → Proceso de venta.
        </div>
      )}

      <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 24 }}>
        Analizar otra llamada
      </Link>
      <Link href="/analisis" className="c5-back-link">Volver a Mi día</Link>
    </div>
  );
}

function WhatsAppCard({ message, phone }: { message: string; phone?: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const cleanPhone = phone
    ? phone.replace(/[\s\-\(\)]/g, "").replace(/^(\+?52)?/, "52")
    : null;
  const waUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : null;

  return (
    <div className="c3-wa-card">
      <p className="c3-wa-msg">{message}</p>
      <div className="c3-wa-actions">
        <button className="c3-wa-copy" onClick={handleCopy}>
          {copied ? "\u2713 Copiado" : "Copiar mensaje"}
        </button>
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="c3-wa-open">
            Enviar por WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
