"use client";

import { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { stripJson } from "../../../lib/text";
import EditableField from "../../components/EditableName";

interface Phase {
  phase_name: string;
  score: number;
  score_max: number;
}

interface ChecklistItem {
  field: string;
  covered: boolean;
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
  related_analysis_id: string | null;
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

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      // super_admin may be viewing an analysis from an org different
      // from their profile org (admin_active_org_id). RLS would hide
      // it, so route through the service-role endpoint instead.
      if (session.realRole === "super_admin") {
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
        .select("id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, prospect_name, prospect_zone, property_type, business_type, equipment_type, vehicle_interest, financing_type, sale_reason, prospect_phone, checklist_results, manager_note, notes, lead_estado, related_analysis_id, created_at, scorecard_id")
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

  const isQualified = !analysis.categoria_descalificacion || analysis.categoria_descalificacion.length === 0;
  const momento = stripJson(analysis.momento_critico) || null;
  const mejora = stripJson(analysis.patron_error) || null;
  const accion = stripJson(analysis.siguiente_accion) || null;
  const objecion = stripJson(analysis.objecion_principal) || null;

  const checklist = analysis.checklist_results || [];
  const covered = checklist.filter(c => c.covered).length;
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
            {vertical === "financiero" ? (
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
        ) : (
          <div className="c3-lead-badge c3-lead-calificado">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Lead calificado
          </div>
        )}
        {analysis.lead_estado === "descartado" && (analysis.categoria_descalificacion || []).length > 0 && (
          <div className="c3-descal-reasons">
            {(analysis.categoria_descalificacion || []).map((code, i) => (
              <span key={i} className="c3-descal-pill">{descalLabels[code] || code}</span>
            ))}
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
        {isQualified ? (
          <span className="c3-pill c3-pill-green">Lead calificado</span>
        ) : (
          <div className="c3-pill-list">
            {(analysis.categoria_descalificacion || []).map((code, i) => (
              <span key={i} className={`c3-pill ${i === 0 ? "c3-pill-primary" : "c3-pill-secondary"}`}>
                {descalLabels[code] || code}
              </span>
            ))}
          </div>
        )}
      </div>

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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div>
            <span className="c3-card-title">Patrón a corregir</span>
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
        const msgMatch = accion.match(/[Mm]ensaje\s*(?:sugerido)?[:\s]+([\s\S]+)/);
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

      {/* 5. CHECKLIST VISUAL */}
      {checklist.length > 0 && (
        <details className="c3-expandable">
          <summary className="c3-expand-summary">Ver checklist completo ({covered}/{total})</summary>
          <div className="c3-checklist">
            {checklist.map((item, i) => (
              <div key={i} className={`c3-check-item ${item.covered ? "c3-check-yes" : "c3-check-no"}`}>
                <span className="c3-check-icon">{item.covered ? "\u2713" : "\u2717"}</span>
                <span className="c3-check-label">{item.field}</span>
              </div>
            ))}
          </div>
        </details>
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

  const waUrl = phone
    ? `https://wa.me/52${phone}?text=${encodeURIComponent(message)}`
    : null;

  return (
    <div className="c3-wa-card">
      <p className="c3-wa-msg">{message}</p>
      <div className="c3-wa-actions">
        <button className="c3-wa-copy" onClick={handleCopy}>
          {copied ? "Copiado" : "Copiar mensaje"}
        </button>
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="c3-wa-open">
            Abrir WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
