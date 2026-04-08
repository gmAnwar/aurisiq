"use client";

import { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
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

      const { data: a, error: aErr } = await supabase
        .from("analyses")
        .select("id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, prospect_name, prospect_zone, property_type, business_type, equipment_type, vehicle_interest, financing_type, sale_reason, prospect_phone, checklist_results, manager_note, related_analysis_id, created_at, scorecard_id")
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
        <div className={`c3-result-badge ${isQualified ? "c3-badge-qualified" : "c3-badge-followup"}`}>
          {isQualified ? "Lead calificado" : "Requiere seguimiento"}
        </div>
        {vertical !== "financiero" && vertical !== "automotriz" && analysis.sale_reason && analysis.sale_reason !== "No mencionado" && (
          <p className="c3-prospect-reason">Motivo de venta: {analysis.sale_reason}</p>
        )}
        {analysis.prospect_phone && (
          <p className="c3-prospect-reason">Tel: {analysis.prospect_phone}</p>
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
          <div className="c3-score-inline">
            <span className="c3-score-value">{analysis.score_general}</span>
            {analysis.clasificacion && (
              <span className={`c3-clasificacion c3-clas-${analysis.clasificacion}`}>
                {analysis.clasificacion}
              </span>
            )}
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

      {/* Coaching */}
      {mejora && (
        <div className="c3-section">
          <p className="c3-section-label">Para tu siguiente llamada</p>
          <p className="c3-improvement">{mejora}</p>
        </div>
      )}

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
