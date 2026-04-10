"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import EditableField from "../../components/EditableName";

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  funnel_stage_id: string | null;
  categoria_descalificacion: string[] | null;
  prospect_name: string | null;
  prospect_zone: string | null;
}

export default function HistorialPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setIsSuperAdmin(session.realRole === "super_admin");

      const [analysesRes, stagesRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, funnel_stage_id, categoria_descalificacion, prospect_name, prospect_zone")
          .eq("user_id", session.userId).eq("organization_id", session.organizationId).eq("status", "completado")
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", session.organizationId),
      ]);

      setAnalyses(analysesRes.data || []);

      const sm: Record<string, string> = {};
      for (const s of stagesRes.data || []) sm[s.id] = s.name;
      setStages(sm);

      setLoading(false);
    }
    load();
  }, []);

  const updateField = useCallback((id: string, field: string, val: string) => {
    setAnalyses(prev => prev.map(a => a.id === id ? { ...a, [field]: val } : a));
  }, []);

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    const targetId = pendingDeleteId;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/delete-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ analysis_id: targetId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Error al eliminar");
        return;
      }
      setAnalyses(prev => prev.filter(a => a.id !== targetId));
      setPendingDeleteId(null);
    } catch {
      alert("Error de red al eliminar");
    }
  }

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  return (
    <div className="container c4-container">
      <div className="c4-header">
        <h1 className="c4-greeting">Mis análisis</h1>
        <p className="c4-date">{analyses.length} llamada{analyses.length !== 1 ? "s" : ""} analizadas</p>
      </div>

      {analyses.length === 0 ? (
        <div className="c4-empty">
          <p className="c4-empty-title">Aún no tienes análisis</p>
          <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 12 }}>
            Hacer mi primera llamada
          </Link>
        </div>
      ) : (
        <div className="c4-list">
          {analyses.map((a) => {
            const date = new Date(a.created_at);
            const dateStr = date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
            const timeStr = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
            const codes = a.categoria_descalificacion || [];
            const qualified = codes.length === 0;
            const stageName = a.funnel_stage_id ? stages[a.funnel_stage_id] : null;
            return (
              <div key={a.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <Link href={`/analisis/${a.id}`} className="c4-item" style={{ flex: 1 }}>
                    <div className="c4-item-left">
                      <span className="c4-item-date">
                        <EditableField analysisId={a.id} field="prospect_name" currentValue={a.prospect_name} placeholder="Sin nombre" onSave={(n) => updateField(a.id, "prospect_name", n)} />
                        {" · "}
                        <EditableField analysisId={a.id} field="prospect_zone" currentValue={a.prospect_zone} placeholder="Zona" onSave={(n) => updateField(a.id, "prospect_zone", n)} />
                      </span>
                      <span className="c4-item-source">
                        {dateStr} · {timeStr}
                        {stageName && <> · {stageName}</>}
                        {" · "}
                        {qualified ? (
                          <span className="c1-pill-inline c1-pill-green">Calificado</span>
                        ) : (
                          <span className="c1-pill-inline c1-pill-red">No calificado</span>
                        )}
                      </span>
                    </div>
                    <div className="c4-item-right">
                      {a.score_general !== null && (
                        <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general}</span>
                      )}
                    </div>
                  </Link>
                  {isSuperAdmin && (
                    <button
                      onClick={(e) => { e.preventDefault(); setPendingDeleteId(a.id); }}
                      style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: "8px", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" }}
                      title="Eliminar análisis"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
                {pendingDeleteId === a.id && (
                  <div style={{ padding: "10px 16px", background: "#fff4f4", borderRadius: 6, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <p style={{ margin: 0, color: "#991b1b", fontSize: 13 }}>¿Eliminar este análisis? Esta acción no se puede deshacer.</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setPendingDeleteId(null)} style={{ background: "none", border: "1px solid #d4d4d4", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>Cancelar</button>
                      <button onClick={confirmDelete} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>Confirmar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Link href="/analisis" className="c5-back-link">Volver a Mi día</Link>
    </div>
  );
}
