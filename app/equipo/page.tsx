"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { getOrgTimezone } from "../../lib/dates";
import {
  getPresetRange,
  getPreviousPeriod,
  PRESET_LABELS,
  formatDateShort,
  fromISODate,
  type PresetKey,
  type DateRange,
} from "../../lib/date-presets";
import DateRangeFilter from "../components/DateRangeFilter";

interface CaptadoraCard {
  userId: string;
  name: string;
  avgScore: number;
  count: number;
  delta: number | null;
  dailyDone: number;
  dailyTarget: number | null;
  status: "green" | "yellow" | "red" | "none";
}

interface RecentCall {
  id: string;
  userName: string;
  prospect_name: string | null;
  score_general: number | null;
  clasificacion: string | null;
  categoria_descalificacion: string[] | null;
  fuente_lead_id: string | null;
  funnel_stage_id: string | null;
  property_type: string | null;
  business_type: string | null;
  created_at: string;
}

interface Insight {
  icon: string;
  text: string;
}

function EquipoDashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rangeParam = (searchParams.get("range") as PresetKey | "custom" | null) || "this_month";
  const fromParam = searchParams.get("from") || undefined;
  const toParam = searchParams.get("to") || undefined;

  const [tz, setTz] = useState<string>("America/Monterrey");
  const [orgId, setOrgId] = useState<string>("");
  const [orgName, setOrgName] = useState("");
  const [periodCount, setPeriodCount] = useState(0);
  const [previousCount, setPreviousCount] = useState(0);
  const [periodAvg, setPeriodAvg] = useState<number | null>(null);
  const [periodQualified, setPeriodQualified] = useState(0);
  const [captadoras, setCaptadoras] = useState<CaptadoraCard[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<{ id: string; description: string }[]>([]);
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [, setLeadSourceMap] = useState<Record<string, string>>({});
  const [stageMap, setStageMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [topPatterns, setTopPatterns] = useState<{ text: string; count: number }[]>([]);
  const [periodAnalysisCount, setPeriodAnalysisCount] = useState(0);

  const dateRange = useMemo<DateRange | null>(() => {
    if (rangeParam === "custom" && fromParam && toParam) {
      const from = fromISODate(fromParam);
      const to = new Date(fromISODate(toParam).getTime() + 86400000);
      return { from, to };
    }
    return getPresetRange(rangeParam as PresetKey, tz);
  }, [rangeParam, fromParam, toParam, tz]);

  const previousRange = useMemo<DateRange | null>(() => {
    if (!dateRange) return null;
    return getPreviousPeriod(rangeParam, dateRange, tz);
  }, [rangeParam, dateRange, tz]);

  const periodLabel = useMemo(() => {
    if (rangeParam === "custom" && fromParam && toParam) {
      return `Personalizado: ${formatDateShort(fromISODate(fromParam))} – ${formatDateShort(fromISODate(toParam))}`;
    }
    return PRESET_LABELS[rangeParam as PresetKey] || "Período";
  }, [rangeParam, fromParam, toParam]);

  useEffect(() => {
    async function init() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;
      const { data: org } = await supabase.from("organizations").select("name").eq("id", session.organizationId).single();
      setOrgName(org?.name || "");
      const orgTz = await getOrgTimezone(session.organizationId);
      setTz(orgTz);
      setOrgId(session.organizationId);
    }
    init();
  }, []);

  useEffect(() => {
    if (!orgId) return;

    async function load() {
      const fromIso = dateRange?.from.toISOString();
      const toIso = dateRange?.to.toISOString();
      const prevFromIso = previousRange?.from.toISOString();
      const prevToIso = previousRange?.to.toISOString();

      let periodQuery = supabase.from("analyses")
        .select("id, user_id, score_general, categoria_descalificacion, lead_quality, patron_error")
        .eq("organization_id", orgId).eq("status", "completado");
      if (fromIso && toIso) {
        periodQuery = periodQuery.gte("created_at", fromIso).lt("created_at", toIso);
      }

      const previousPromise = previousRange && prevFromIso && prevToIso
        ? supabase.from("analyses").select("id, user_id, score_general")
            .eq("organization_id", orgId).eq("status", "completado")
            .gte("created_at", prevFromIso).lt("created_at", prevToIso)
        : Promise.resolve({ data: [] as { id: string; user_id: string; score_general: number | null }[] });

      const [teamRes, periodRes, previousRes, objRes, alertsRes, descalRes, recentRes, leadSourcesRes, stagesRes] = await Promise.all([
        supabase.from("users").select("id, name, role, roles").eq("organization_id", orgId).eq("active", true),
        periodQuery,
        previousPromise,
        supabase.from("objectives").select("target_user_id, target_value, type, period_type")
          .eq("organization_id", orgId).eq("is_active", true).eq("type", "volume").in("period_type", ["monthly"]),
        supabase.from("alerts").select("id, description")
          .eq("organization_id", orgId).eq("status", "activa").order("created_at", { ascending: false }).limit(5),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", orgId),
        supabase.from("analyses").select("id, user_id, prospect_name, score_general, clasificacion, categoria_descalificacion, lead_quality, fuente_lead_id, created_at, funnel_stage_id, property_type, business_type")
          .eq("organization_id", orgId).eq("status", "completado").order("created_at", { ascending: false }).limit(10),
        supabase.from("lead_sources").select("id, name").eq("organization_id", orgId),
        supabase.from("funnel_stages").select("id, name").eq("organization_id", orgId).eq("active", true),
      ]);

      setActiveAlerts(alertsRes.data || []);
      const dm: Record<string, string> = {};
      for (const c of descalRes.data || []) dm[c.code] = c.label;
      setDescalMap(dm);
      const lsm: Record<string, string> = {};
      for (const ls of leadSourcesRes.data || []) lsm[ls.id] = ls.name;
      setLeadSourceMap(lsm);
      const stgm: Record<string, string> = {};
      for (const s of stagesRes.data || []) stgm[s.id] = s.name;
      setStageMap(stgm);

      const caps = (teamRes.data || []).filter(u => (u.roles as string[] | null)?.includes("captadora") ?? u.role === "captadora");
      const capNames: Record<string, string> = {};
      for (const u of teamRes.data || []) capNames[u.id] = u.name;

      const period = periodRes.data || [];
      const previous = previousRes.data || [];

      setPeriodCount(period.length);
      setPreviousCount(previous.length);
      const periodScores = period.filter(a => a.score_general !== null).map(a => a.score_general!);
      setPeriodAvg(periodScores.length > 0 ? Math.round(periodScores.reduce((a, b) => a + b, 0) / periodScores.length) : null);
      setPeriodQualified(period.filter(a => (a as { lead_quality?: string }).lead_quality === "calificado").length);

      setPeriodAnalysisCount(period.length);
      const patternCounts: Record<string, number> = {};
      for (const a of period) {
        const raw = (a as { patron_error?: string | null }).patron_error;
        if (raw) {
          const cleaned = raw.replace(/^[-•*]\s*/, "").slice(0, 150).trim();
          if (cleaned) patternCounts[cleaned] = (patternCounts[cleaned] || 0) + 1;
        }
      }
      const sorted = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      setTopPatterns(sorted.map(([text, count]) => ({ text, count })));

      const periodByUser: Record<string, number[]> = {};
      const previousByUser: Record<string, number[]> = {};
      const periodCountByUser: Record<string, number> = {};

      for (const a of period) { if (a.score_general !== null) { if (!periodByUser[a.user_id]) periodByUser[a.user_id] = []; periodByUser[a.user_id].push(a.score_general); } }
      for (const a of previous) { if (a.score_general !== null) { if (!previousByUser[a.user_id]) previousByUser[a.user_id] = []; previousByUser[a.user_id].push(a.score_general); } }
      for (const a of period) { periodCountByUser[a.user_id] = (periodCountByUser[a.user_id] || 0) + 1; }

      const globalObj = (objRes.data || []).find(o => !o.target_user_id);
      const objByUser: Record<string, number> = {};
      for (const o of objRes.data || []) { if (o.target_user_id) objByUser[o.target_user_id] = o.target_value; }

      const isToday = rangeParam === "today";
      const cards: CaptadoraCard[] = caps.map(u => {
        const ws2 = periodByUser[u.id] || [];
        const ps = previousByUser[u.id] || [];
        const thisAvg = ws2.length > 0 ? Math.round(ws2.reduce((a, b) => a + b, 0) / ws2.length) : 0;
        const prevA = ps.length > 0 ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
        const target = objByUser[u.id] || (globalObj?.target_value ?? null);
        const dailyTarget = target !== null ? Math.max(1, Math.ceil(target / 22)) : null;
        const dailyDone = periodCountByUser[u.id] || 0;
        let status: "green" | "yellow" | "red" | "none" = "none";
        if (isToday && dailyTarget !== null) {
          const pct = dailyDone / dailyTarget;
          status = pct >= 1 ? "green" : pct >= 0.5 ? "yellow" : "red";
        }
        return { userId: u.id, name: u.name, avgScore: thisAvg, count: ws2.length, delta: prevA !== null && ws2.length > 0 ? thisAvg - prevA : null, dailyDone, dailyTarget, status };
      });

      cards.sort((a, b) => b.avgScore - a.avgScore);
      setCaptadoras(cards);

      setRecentCalls((recentRes.data || []).map(a => ({
        ...a,
        userName: capNames[a.user_id] || "—",
      })));

      const ins: Insight[] = [];
      const hasPrev = previousRange !== null;
      for (const c of cards) {
        if (hasPrev && c.delta !== null && c.delta < -10) ins.push({ icon: "⚠️", text: `${c.name} bajó ${Math.abs(c.delta)} pts vs período anterior — revisar llamadas` });
        if (hasPrev && c.delta !== null && c.delta > 10 && c.count >= 3) ins.push({ icon: "🎯", text: `${c.name} subió ${c.delta} pts vs período anterior — buen progreso` });
      }
      const descalCounts: Record<string, number> = {};
      for (const a of period) { for (const code of a.categoria_descalificacion || []) descalCounts[code] = (descalCounts[code] || 0) + 1; }
      const topDescal = Object.entries(descalCounts).sort((a, b) => b[1] - a[1])[0];
      if (topDescal && topDescal[1] >= 3) {
        ins.push({ icon: "📉", text: `${topDescal[1]} leads descartados por "${dm[topDescal[0]] || topDescal[0]}" en el período` });
      }
      setInsights(ins.slice(0, 4));

      setLoading(false);
    }
    load();
  }, [orgId, dateRange?.from.getTime(), dateRange?.to.getTime(), previousRange?.from.getTime(), previousRange?.to.getTime(), rangeParam]);

  const updateRange = (newRange: PresetKey | "custom", from?: string, to?: string) => {
    const params = new URLSearchParams();
    params.set("range", newRange);
    if (newRange === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    router.push(`/equipo?${params.toString()}`, { scroll: false });
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block" style={{height:80}}/></div></div>);

  const statusEmoji = { green: "🟢", yellow: "🟡", red: "🔴", none: "⚙️" };
  const periodDelta = periodCount - previousCount;
  const showDelta = previousRange !== null;

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Dashboard — {orgName}</h1>
        </div>

        {activeAlerts.length > 0 && (
          <div className="a1-alert-banner" style={{ marginBottom: 14 }}>
            <span className="a1-alert-banner-icon">⚡</span>
            <div className="a1-alert-banner-text">
              <strong>{activeAlerts.length} alerta{activeAlerts.length > 1 ? "s" : ""}</strong>
              {" — "}{activeAlerts[0].description?.slice(0, 100) || "Revisar alertas"}
            </div>
          </div>
        )}

        <DateRangeFilter
          range={rangeParam as PresetKey | "custom"}
          from={fromParam}
          to={toParam}
          onChange={updateRange}
          tz={tz}
        />

        <div className="g1-today-card">
          <span className="g1-today-label">{periodLabel}</span>
          <div className="g1-today-stats">
            <span>{periodCount} llamadas</span>
            <span>Score: {periodAvg ?? "—"}</span>
            <span>{periodQualified}/{periodCount} calificados</span>
          </div>
          {showDelta && periodDelta !== 0 && (
            <span className={`g1-today-delta ${periodDelta > 0 ? "g1-delta-up" : "g1-delta-down"}`}>
              {periodDelta > 0 ? "+" : ""}{periodDelta} vs período anterior
            </span>
          )}
        </div>

        {insights.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Insights</h2>
            <div className="g1-insights">
              {insights.map((ins, i) => (
                <div key={i} className="g1-insight-row">
                  <span className="g1-insight-icon">{ins.icon}</span>
                  <span className="g1-insight-text">{ins.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="g1-section">
          <h2 className="g1-section-title">Ranking del período</h2>
          <div className="g1-traffic">
            {captadoras.filter(c => c.count > 0).map((c, i) => (
              <a key={c.userId} href={`/equipo/captadora/${c.userId}`} className="g1-traffic-card" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="g1-rank">#{i + 1}</span>
                <span className="g1-traffic-status">{statusEmoji[c.status]}</span>
                <div className="g1-traffic-info">
                  <span className="g1-traffic-name">{c.name}</span>
                  <span className="g1-traffic-detail">
                    {c.count} llamadas · Score: {c.avgScore}
                    {showDelta && c.delta !== null && (
                      <span className={c.delta > 0 ? "g1-delta-up" : c.delta < 0 ? "g1-delta-down" : ""}>
                        {" "}{c.delta > 0 ? "↑" : c.delta < 0 ? "↓" : ""}{Math.abs(c.delta)}
                      </span>
                    )}
                    {rangeParam === "today" && c.dailyTarget !== null ? ` · Hoy: ${c.dailyDone}/${c.dailyTarget}` : ""}
                  </span>
                </div>
              </a>
            ))}
            {captadoras.filter(c => c.count > 0).length === 0 && (
              <p style={{ fontSize: 13, color: "var(--ink-light)", padding: "12px 0" }}>Nadie ha registrado llamadas en este período.</p>
            )}
          </div>
        </div>

        <div className="g1-section">
          <h2 className="g1-section-title">Patrones más frecuentes</h2>
          {periodAnalysisCount < 5 ? (
            <p className="g1-patterns-empty">Datos insuficientes aún ({periodAnalysisCount} análisis en el período)</p>
          ) : topPatterns.length === 0 ? (
            <p className="g1-patterns-empty">Sin patrones detectados en el período</p>
          ) : (
            <div className="g1-patterns-list">
              {topPatterns.map((p, i) => (
                <div key={i} className="g1-pattern-row">
                  <span className="g1-pattern-count">{p.count}x</span>
                  <span className="g1-pattern-text">{p.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {recentCalls.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Últimas llamadas del equipo</h2>
            <div className="c4-list">
              {recentCalls.map(a => {
                const time = new Date(a.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
                const day = new Date(a.created_at).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" });
                const codes = a.categoria_descalificacion || [];
                return (
                  <a key={a.id} href={`/equipo/analisis/${a.id}`} className="c4-item" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="c4-item-left">
                      <span className="c4-item-date">{a.userName} · {a.prospect_name || "Sin nombre"}</span>
                      <span className="c4-item-source">
                        {day} {time}
                        {a.funnel_stage_id && stageMap[a.funnel_stage_id] ? ` · ${stageMap[a.funnel_stage_id]}` : ""}
                        {(a.property_type || a.business_type) ? ` · ${a.property_type || a.business_type}` : ""}
                        {" · "}{(a as { lead_quality?: string }).lead_quality === "descalificado" ? (
                          <span className="c1-pill-inline c1-pill-red">{codes.length > 0 ? (descalMap[codes[0]] || codes[0]) : "Descalificado"}</span>
                        ) : (a as { lead_quality?: string }).lead_quality === "calificado" ? (
                          <span className="c1-pill-inline c1-pill-green">Calificado</span>
                        ) : (
                          <span className="c1-pill-inline c1-pill-yellow">Indeterminado</span>
                        )}
                      </span>
                    </div>
                    <div className="c4-item-right">
                      {a.score_general !== null && (
                        <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general}</span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EquipoDashboard() {
  return (
    <Suspense fallback={<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /></div></div>}>
      <EquipoDashboardInner />
    </Suspense>
  );
}
