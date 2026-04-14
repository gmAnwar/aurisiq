"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

const PAGE_SIZE = 20;

export default function HistorialPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Filters
  const [dateFilter, setDateFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setIsSuperAdmin(session.realRoles.includes("super_admin"));

      const [analysesRes, stagesRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, funnel_stage_id, categoria_descalificacion, prospect_name, prospect_zone")
          .eq("user_id", session.userId).eq("organization_id", session.organizationId).eq("status", "completado")
          .order("created_at", { ascending: false }),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", session.organizationId).eq("active", true),
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

  // Client-side filtering
  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    return analyses.filter(a => {
      // Date filter
      if (dateFilter === "today" && a.created_at < todayStart) return false;
      if (dateFilter === "week" && a.created_at < weekAgo) return false;
      if (dateFilter === "month" && a.created_at < monthAgo) return false;

      // Score filter
      if (scoreFilter === "high" && (a.score_general === null || a.score_general < 80)) return false;
      if (scoreFilter === "mid" && (a.score_general === null || a.score_general < 60 || a.score_general >= 80)) return false;
      if (scoreFilter === "low" && (a.score_general === null || a.score_general >= 60)) return false;

      // Stage filter
      if (stageFilter !== "all" && a.funnel_stage_id !== stageFilter) return false;

      // Text search
      if (search) {
        const q = search.toLowerCase();
        const name = (a.prospect_name || "").toLowerCase();
        const zone = (a.prospect_zone || "").toLowerCase();
        if (!name.includes(q) && !zone.includes(q)) return false;
      }

      return true;
    });
  }, [analyses, dateFilter, scoreFilter, stageFilter, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [dateFilter, scoreFilter, stageFilter, search]);

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  const stageList = Object.entries(stages);

  return (
    <div className="container c4-container">
      <div className="c4-header">
        <h1 className="c4-greeting">Mis análisis</h1>
        <p className="c4-date">{filtered.length} de {analyses.length} llamada{analyses.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Filters */}
      {analyses.length > 0 && (
        <div className="historial-filters">
          <input
            className="historial-search"
            type="text"
            placeholder="Buscar prospecto o zona..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="historial-select" value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            <option value="all">Todo</option>
            <option value="today">Hoy</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mes</option>
          </select>
          <select className="historial-select" value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}>
            <option value="all">Todos los scores</option>
            <option value="high">80+</option>
            <option value="mid">60–79</option>
            <option value="low">&lt; 60</option>
          </select>
          {stageList.length > 0 && (
            <select className="historial-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
              <option value="all">Todas las etapas</option>
              {stageList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      )}

      {filtered.length === 0 && analyses.length > 0 ? (
        <div className="c4-empty">
          <p className="c4-empty-title">Sin resultados con estos filtros</p>
          <button className="adm-btn-ghost" onClick={() => { setDateFilter("all"); setScoreFilter("all"); setStageFilter("all"); setSearch(""); }}>Limpiar filtros</button>
        </div>
      ) : analyses.length === 0 ? (
        <div className="c4-empty">
          <p className="c4-empty-title">Aún no tienes análisis</p>
          <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 12 }}>
            Hacer mi primera llamada
          </Link>
        </div>
      ) : (
        <>
          <div className="c4-list">
            {visible.map((a) => {
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
                        className="historial-delete-btn"
                        onClick={(e) => { e.preventDefault(); setPendingDeleteId(a.id); }}
                        title="Eliminar análisis"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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

          {hasMore && (
            <button className="historial-load-more" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
              Cargar más ({filtered.length - visibleCount} restantes)
            </button>
          )}
        </>
      )}

      <Link href="/analisis" className="c5-back-link">Volver a Mi día</Link>
    </div>
  );
}
