"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import EditableField from "../../components/EditableName";
import { PRESET_LABELS, getPresetRange, toISODate, fromISODate, formatDateShort, type PresetKey } from "../../../lib/date-presets";

export default function HistorialWrapper() {
  return (
    <Suspense fallback={<div className="container c4-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div>}>
      <HistorialPage />
    </Suspense>
  );
}

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  funnel_stage_id: string | null;
  categoria_descalificacion: string[] | null;
  lead_quality: string | null;
  lead_outcome: string | null;
  prospect_name: string | null;
  prospect_zone: string | null;
}

const PAGE_SIZE = 20;

const OUTCOME_GROUPS: Record<string, string[]> = {
  cerrados: ["cerrado_completo", "cerrado_parcial"],
  pospuestos: ["pospuesto_con_agenda", "pospuesto_sin_agenda"],
  perdidos: ["perdido"],
  descalificados: ["descalificado"],
};

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  cerrado_completo: { label: "Cerrado completo", cls: "c1-pill-green" },
  cerrado_parcial: { label: "Cerrado parcial", cls: "c1-pill-green" },
  pospuesto_con_agenda: { label: "Con agenda", cls: "c1-pill-blue" },
  pospuesto_sin_agenda: { label: "Sin agenda", cls: "c1-pill-yellow" },
  descalificado: { label: "Descalificado", cls: "c1-pill-gray" },
  perdido: { label: "Perdido", cls: "c1-pill-red" },
};

const QUALITY_DOT: Record<string, string> = {
  calificado: "#22c55e",
  indeterminado: "#eab308",
  descalificado: "#ef4444",
};

function HistorialPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Filters from URL
  const rangeParam = searchParams.get("range") || "all";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const outcomeParam = searchParams.get("outcome") || "all";
  const qualityParam = searchParams.get("quality") || "all";
  const scoreParam = searchParams.get("score") || "all";
  const stageParam = searchParams.get("stage") || "all";
  const searchParam = searchParams.get("q") || "";

  // Local search state (debounced URL update)
  const [searchText, setSearchText] = useState(searchParam);

  // Custom date picker
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(fromParam || "");
  const [customTo, setCustomTo] = useState(toParam || "");

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const setFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    // Reset custom date params when switching to preset
    if (key === "range" && value !== "custom") {
      params.delete("from");
      params.delete("to");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setFilter("q", searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setIsSuperAdmin(session.realRoles.includes("super_admin"));

      const [analysesRes, stagesRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, funnel_stage_id, categoria_descalificacion, lead_quality, lead_outcome, prospect_name, prospect_zone")
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
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ analysis_id: targetId }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error || "Error al eliminar"); return; }
      setAnalyses(prev => prev.filter(a => a.id !== targetId));
      setPendingDeleteId(null);
    } catch { alert("Error de red al eliminar"); }
  }

  const applyCustomRange = () => {
    if (!customFrom || !customTo) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo);
    router.replace(`?${params.toString()}`, { scroll: false });
    setShowCustom(false);
  };

  // Client-side filtering
  const filtered = useMemo(() => {
    return analyses.filter(a => {
      // Date filter
      if (rangeParam === "custom" && fromParam && toParam) {
        const from = fromISODate(fromParam);
        const to = new Date(fromISODate(toParam).getTime() + 86400000); // inclusive end
        const d = new Date(a.created_at);
        if (d < from || d >= to) return false;
      } else if (rangeParam !== "all" && rangeParam !== "custom") {
        const range = getPresetRange(rangeParam as PresetKey);
        if (range) {
          const d = new Date(a.created_at);
          if (d < range.from || d >= range.to) return false;
        }
      }

      // Score filter
      if (scoreParam === "high" && (a.score_general === null || a.score_general < 80)) return false;
      if (scoreParam === "mid" && (a.score_general === null || a.score_general < 60 || a.score_general >= 80)) return false;
      if (scoreParam === "low" && (a.score_general === null || a.score_general >= 60)) return false;

      // Stage filter
      if (stageParam !== "all" && a.funnel_stage_id !== stageParam) return false;

      // Outcome filter
      if (outcomeParam !== "all") {
        const validOutcomes = OUTCOME_GROUPS[outcomeParam];
        if (validOutcomes && !validOutcomes.includes(a.lead_outcome || "")) return false;
      }

      // Quality filter
      if (qualityParam !== "all") {
        if (qualityParam === "calificados" && a.lead_quality !== "calificado") return false;
        if (qualityParam === "indeterminados" && a.lead_quality !== "indeterminado") return false;
        if (qualityParam === "descalificados" && a.lead_quality !== "descalificado") return false;
      }

      // Text search
      if (searchParam) {
        const q = searchParam.toLowerCase();
        const name = (a.prospect_name || "").toLowerCase();
        const zone = (a.prospect_zone || "").toLowerCase();
        if (!name.includes(q) && !zone.includes(q)) return false;
      }

      return true;
    });
  }, [analyses, rangeParam, fromParam, toParam, scoreParam, stageParam, outcomeParam, qualityParam, searchParam]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [rangeParam, fromParam, toParam, scoreParam, stageParam, outcomeParam, qualityParam, searchParam]);

  // Label for current date range
  const dateLabel = rangeParam === "custom" && fromParam && toParam
    ? `${formatDateShort(fromISODate(fromParam))} – ${formatDateShort(fromISODate(toParam))}`
    : PRESET_LABELS[rangeParam as PresetKey] || "Todo";

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  const stageList = Object.entries(stages);
  const hasActiveFilters = rangeParam !== "all" || outcomeParam !== "all" || qualityParam !== "all" || scoreParam !== "all" || stageParam !== "all" || searchParam !== "";

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
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          <div style={{ position: "relative" }}>
            <select
              className="historial-select"
              value={rangeParam === "custom" ? "custom" : rangeParam}
              onChange={e => {
                if (e.target.value === "custom") {
                  setShowCustom(true);
                } else {
                  setShowCustom(false);
                  setFilter("range", e.target.value);
                }
              }}
            >
              {(Object.keys(PRESET_LABELS) as PresetKey[]).map(k => (
                <option key={k} value={k}>{PRESET_LABELS[k]}</option>
              ))}
              <option value="custom">{rangeParam === "custom" ? dateLabel : "Personalizado..."}</option>
            </select>
            {showCustom && (
              <div className="historial-custom-picker">
                <label style={{ fontSize: 12, color: "var(--ink-light)" }}>Desde</label>
                <input type="date" className="historial-date-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <label style={{ fontSize: 12, color: "var(--ink-light)" }}>Hasta</label>
                <input type="date" className="historial-date-input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button className="historial-apply-btn" onClick={applyCustomRange} disabled={!customFrom || !customTo}>Aplicar</button>
                  <button className="historial-cancel-btn" onClick={() => setShowCustom(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
          <select className="historial-select" value={outcomeParam} onChange={e => setFilter("outcome", e.target.value)}>
            <option value="all">Todos los resultados</option>
            <option value="cerrados">Cerrados</option>
            <option value="pospuestos">Pospuestos</option>
            <option value="perdidos">Perdidos</option>
            <option value="descalificados">Descalificados</option>
          </select>
          <select className="historial-select" value={qualityParam} onChange={e => setFilter("quality", e.target.value)}>
            <option value="all">Todas las calidades</option>
            <option value="calificados">Calificados</option>
            <option value="indeterminados">Indeterminados</option>
            <option value="descalificados">Descalificados</option>
          </select>
          <select className="historial-select" value={scoreParam} onChange={e => setFilter("score", e.target.value)}>
            <option value="all">Todos los scores</option>
            <option value="high">80+</option>
            <option value="mid">60–79</option>
            <option value="low">&lt; 60</option>
          </select>
          {stageList.length > 0 && (
            <select className="historial-select" value={stageParam} onChange={e => setFilter("stage", e.target.value)}>
              <option value="all">Todas las etapas</option>
              {stageList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Active filter summary */}
      {hasActiveFilters && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-light)" }}>Filtros activos:</span>
          {rangeParam !== "all" && <span className="historial-chip">{dateLabel}</span>}
          {outcomeParam !== "all" && <span className="historial-chip">{outcomeParam}</span>}
          {qualityParam !== "all" && <span className="historial-chip">{qualityParam}</span>}
          {scoreParam !== "all" && <span className="historial-chip">{scoreParam === "high" ? "80+" : scoreParam === "mid" ? "60-79" : "<60"}</span>}
          {stageParam !== "all" && <span className="historial-chip">{stages[stageParam] || stageParam}</span>}
          {searchParam && <span className="historial-chip">&quot;{searchParam}&quot;</span>}
          <button
            style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
            onClick={() => router.replace("?", { scroll: false })}
          >
            Limpiar
          </button>
        </div>
      )}

      {filtered.length === 0 && analyses.length > 0 ? (
        <div className="c4-empty">
          <p className="c4-empty-title">Sin resultados con estos filtros</p>
          <button className="adm-btn-ghost" onClick={() => router.replace("?", { scroll: false })}>Limpiar filtros</button>
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
              const stageName = a.funnel_stage_id ? stages[a.funnel_stage_id] : null;
              const outcomeBadge = a.lead_outcome ? OUTCOME_BADGE[a.lead_outcome] : null;
              const qualityColor = a.lead_quality ? QUALITY_DOT[a.lead_quality] : null;

              return (
                <div key={a.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                    <Link href={`/analisis/${a.id}`} className="c4-item" style={{ flex: 1 }}>
                      <div className="c4-item-left">
                        <span className="c4-item-date">
                          {qualityColor && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: qualityColor, marginRight: 6, verticalAlign: "middle" }} />}
                          <EditableField analysisId={a.id} field="prospect_name" currentValue={a.prospect_name} placeholder="Sin nombre" onSave={(n) => updateField(a.id, "prospect_name", n)} />
                          {" · "}
                          <EditableField analysisId={a.id} field="prospect_zone" currentValue={a.prospect_zone} placeholder="Zona" onSave={(n) => updateField(a.id, "prospect_zone", n)} />
                        </span>
                        <span className="c4-item-source">
                          {dateStr} · {timeStr}
                          {stageName && <> · {stageName}</>}
                          {" · "}
                          {outcomeBadge
                            ? <span className={`c1-pill-inline ${outcomeBadge.cls}`}>{outcomeBadge.label}</span>
                            : a.lead_quality === "descalificado"
                              ? <span className="c1-pill-inline c1-pill-red">Descalificado</span>
                              : a.lead_quality === "calificado"
                                ? <span className="c1-pill-inline c1-pill-green">Calificado</span>
                                : <span className="c1-pill-inline c1-pill-yellow">Indeterminado</span>
                          }
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
                      <p style={{ margin: 0, color: "#991b1b", fontSize: 13 }}>Eliminar este analisis? No se puede deshacer.</p>
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
