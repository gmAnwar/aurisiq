"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

export default function ROIPage() {
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [convRate, setConvRate] = useState(0);
  const [baselineRate, setBaselineRate] = useState(0);
  const [totalAnalyses, setTotalAnalyses] = useState(0);
  const [additionalConversions, setAdditionalConversions] = useState(0);
  const [roiAmount, setRoiAmount] = useState(0);
  const [roiPct, setRoiPct] = useState(0);
  const [monthlyEvo, setMonthlyEvo] = useState<{ month: string; conversions: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const TIER_COSTS: Record<string, number> = { starter: 0, growth: 99, pro: 299, scale: 799, enterprise: 1999, founder: 0 };

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data: orgData } = await supabase.from("organizations")
        .select("plan, conversion_baseline, ticket_promedio, created_at").eq("id", me.organization_id).single();

      if (!orgData) { setLoading(false); return; }
      setOrg(orgData);

      const quarterStart = new Date();
      quarterStart.setMonth(quarterStart.getMonth() - 3);

      const { data: analyses } = await supabase.from("analyses").select("id, avanzo_a_siguiente_etapa")
        .eq("organization_id", me.organization_id).eq("status", "completado").gte("created_at", quarterStart.toISOString());

      const all = analyses || [];
      setTotalAnalyses(all.length);
      const converted = all.filter(a => a.avanzo_a_siguiente_etapa === "converted").length;
      const currentRate = all.length > 0 ? converted / all.length : 0;
      setConvRate(Math.round(currentRate * 100));

      const baseline = (orgData.conversion_baseline as number) || currentRate;
      setBaselineRate(Math.round(baseline * 100));

      const ticket = (orgData.ticket_promedio as number) || 0;
      const additional = Math.max(0, Math.round((currentRate - baseline) * all.length));
      setAdditionalConversions(additional);

      const revenue = additional * ticket;
      const cost = TIER_COSTS[orgData.plan as string] || 0;
      const monthlyCost = cost * 3;
      const roi = monthlyCost > 0 ? Math.round(((revenue - monthlyCost) / monthlyCost) * 100) : 0;

      setRoiAmount(revenue);
      setRoiPct(roi);

      // Monthly evolution since activation
      const activationStart = new Date(orgData.created_at as string);
      const { data: allAnalyses } = await supabase.from("analyses")
        .select("id, avanzo_a_siguiente_etapa, created_at")
        .eq("organization_id", me.organization_id).eq("status", "completado")
        .gte("created_at", activationStart.toISOString());

      const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const buckets: Record<string, number> = {};
      for (const a of allAnalyses || []) {
        if (a.avanzo_a_siguiente_etapa === "converted") {
          const d = new Date(a.created_at);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          buckets[key] = (buckets[key] || 0) + 1;
        }
      }
      setMonthlyEvo(
        Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
          month: months[parseInt(k.split("-")[1]) - 1],
          conversions: v,
        }))
      );

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const plan = (org?.plan as string) || "starter";
  const cost = TIER_COSTS[plan] || 0;
  const ticket = (org?.ticket_promedio as number) || 0;
  const activationDate = org?.created_at ? new Date(org.created_at as string).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">ROI de AurisIQ</h1>
          <p className="g1-subtitle">Desde {activationDate}</p>
        </div>

        {/* Big number */}
        <div className="d2-hero">
          <span className="d2-hero-value">{additionalConversions}</span>
          <span className="d2-hero-label">Captaciones adicionales este trimestre</span>
        </div>

        {/* Calculation breakdown */}
        <div className="g1-section">
          <h2 className="g1-section-title">Cálculo</h2>
          <div className="d2-calc">
            <div className="d2-calc-row"><span>Línea base de conversión</span><span>{baselineRate}%</span></div>
            <div className="d2-calc-row"><span>Tasa actual</span><span>{convRate}%</span></div>
            <div className="d2-calc-row"><span>Total análisis (trimestre)</span><span>{totalAnalyses}</span></div>
            <div className="d2-calc-row"><span>Captaciones adicionales</span><span>{additionalConversions}</span></div>
            <div className="d2-calc-row"><span>Ticket promedio</span><span>${ticket.toLocaleString()}</span></div>
            <div className="d2-calc-row d2-calc-highlight"><span>Ingreso atribuido</span><span>${roiAmount.toLocaleString()}</span></div>
            <div className="d2-calc-row"><span>Costo del tier ({plan})</span><span>${cost}/mes × 3 = ${cost * 3}</span></div>
            <div className="d2-calc-row d2-calc-highlight"><span>ROI</span><span>{roiPct}% (${(roiAmount - (cost * 3)).toLocaleString()})</span></div>
          </div>
          {!ticket && <p className="g1-empty">El ticket promedio no está configurado. El gerente puede configurarlo en Ajustes.</p>}
          {baselineRate === convRate && <p className="g1-empty">Sin línea base previa — usando el primer trimestre como referencia.</p>}
        </div>

        {/* Monthly evolution chart */}
        {monthlyEvo.length > 1 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Evolución mensual de captaciones</h2>
            <div className="d1-monthly">
              {monthlyEvo.map((m, i) => {
                const maxConv = Math.max(...monthlyEvo.map(x => x.conversions), 1);
                const pct = Math.round((m.conversions / maxConv) * 100);
                return (
                  <div key={i} className="d1-monthly-col">
                    <div className="d1-monthly-bar-wrap">
                      <div className="d1-monthly-bar" style={{ height: `${pct}%` }} />
                    </div>
                    <span className="d1-monthly-rate">{m.conversions}</span>
                    <span className="d1-monthly-label">{m.month}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <a href="/direccion" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
