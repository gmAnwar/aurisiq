"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface FunnelStage { id: string; name: string; stage_type: string; order_index: number; scorecard_id: string | null; }
interface DescalCat { id: string; code: string; label: string; active: boolean; }
interface LeadSrc { id: string; name: string; active: boolean; }

export default function ConfigPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [descalCats, setDescalCats] = useState<DescalCat[]>([]);
  const [leadSrcs, setLeadSrcs] = useState<LeadSrc[]>([]);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [orgId, setOrgId] = useState("");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newSrcName, setNewSrcName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);

      const [stagesRes, catsRes, srcsRes, orgRes] = await Promise.all([
        supabase.from("funnel_stages").select("id, name, stage_type, order_index, scorecard_id")
          .eq("organization_id", session.organizationId).order("order_index"),
        supabase.from("descalification_categories").select("id, code, label, active")
          .eq("organization_id", session.organizationId).order("label"),
        supabase.from("lead_sources").select("id, name, active")
          .eq("organization_id", session.organizationId).order("name"),
        supabase.from("organizations").select("plan, analysis_count_month, access_status, ticket_promedio, conversion_baseline")
          .eq("id", session.organizationId).single(),
      ]);

      setStages(stagesRes.data || []);
      setDescalCats(catsRes.data || []);
      setLeadSrcs(srcsRes.data || []);
      setOrg(orgRes.data);
      setLoading(false);
    }
    load();
  }, []);

  const toggleCat = async (catId: string, currentActive: boolean) => {
    await supabase.from("descalification_categories").update({ active: !currentActive }).eq("id", catId);
    setDescalCats(prev => prev.map(c => c.id === catId ? { ...c, active: !currentActive } : c));
  };

  const addCategory = async () => {
    if (!newCatLabel.trim()) return;
    const code = newCatLabel.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
    const { data } = await supabase.from("descalification_categories")
      .insert({ organization_id: orgId, code, label: newCatLabel.trim(), active: true })
      .select("id, code, label, active").single();
    if (data) setDescalCats(prev => [...prev, data]);
    setNewCatLabel("");
  };

  const toggleSource = async (srcId: string, currentActive: boolean) => {
    await supabase.from("lead_sources").update({ active: !currentActive }).eq("id", srcId);
    setLeadSrcs(prev => prev.map(s => s.id === srcId ? { ...s, active: !currentActive } : s));
  };

  const addSource = async () => {
    if (!newSrcName.trim()) return;
    const { data } = await supabase.from("lead_sources")
      .insert({ organization_id: orgId, name: newSrcName.trim(), active: true })
      .select("id, name, active").single();
    if (data) setLeadSrcs(prev => [...prev, data]);
    setNewSrcName("");
  };

  const updateOrgField = async (field: string, value: unknown) => {
    await supabase.from("organizations").update({ [field]: value }).eq("id", orgId);
    setOrg(prev => prev ? { ...prev, [field]: value } : prev);
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const tierLimits: Record<string, number | null> = { starter: 50, growth: 200, pro: 500, scale: 1500, enterprise: null, founder: 50 };
  const plan = (org?.plan as string) || "starter";
  const used = (org?.analysis_count_month as number) || 0;
  const limit = tierLimits[plan];

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Configuración</h1>
        </div>

        {/* Etapas del embudo */}
        <div className="g1-section">
          <h2 className="g1-section-title">Etapas del embudo</h2>
          <div className="g7-list">
            {stages.map(s => (
              <div key={s.id} className="g7-list-item">
                <span className="g7-item-name">{s.name}</span>
                <span className="g7-item-meta">{s.stage_type}</span>
              </div>
            ))}
          </div>
          {stages.length === 0 && <p className="g1-empty">No hay etapas configuradas.</p>}
        </div>

        {/* Catálogo de Descalificación */}
        <div className="g1-section">
          <h2 className="g1-section-title">Catálogo de descalificación</h2>
          <div className="g7-list">
            {descalCats.map(c => (
              <div key={c.id} className="g7-list-item">
                <div>
                  <span className="g7-item-name">{c.label}</span>
                  <span className="g7-item-code">{c.code}</span>
                </div>
                <label className="g7-toggle">
                  <input type="checkbox" checked={c.active} onChange={() => toggleCat(c.id, c.active)} />
                  <span className="g7-toggle-slider" />
                </label>
              </div>
            ))}
          </div>
          <div className="g7-add-row">
            <input className="input-field" value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nueva categoría..." />
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addCategory}>Agregar</button>
          </div>
        </div>

        {/* Fuentes de Lead */}
        <div className="g1-section">
          <h2 className="g1-section-title">Fuentes de lead</h2>
          <div className="g7-list">
            {leadSrcs.map(s => (
              <div key={s.id} className="g7-list-item">
                <span className="g7-item-name">{s.name}</span>
                <label className="g7-toggle">
                  <input type="checkbox" checked={s.active} onChange={() => toggleSource(s.id, s.active)} />
                  <span className="g7-toggle-slider" />
                </label>
              </div>
            ))}
          </div>
          <div className="g7-add-row">
            <input className="input-field" value={newSrcName} onChange={e => setNewSrcName(e.target.value)} placeholder="Nueva fuente..." />
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addSource}>Agregar</button>
          </div>
        </div>

        {/* Ticket promedio y baseline */}
        <div className="g1-section">
          <h2 className="g1-section-title">Métricas de ROI</h2>
          <div className="g7-field-row">
            <label className="input-label">Ticket promedio ($)</label>
            <input className="input-field" type="number" value={(org?.ticket_promedio as number) || ""} onChange={e => updateOrgField("ticket_promedio", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div className="g7-field-row" style={{ marginTop: 12 }}>
            <label className="input-label">Línea base de conversión (0-1)</label>
            <input className="input-field" type="number" step="0.01" min="0" max="1" value={(org?.conversion_baseline as number) || ""} onChange={e => updateOrgField("conversion_baseline", e.target.value ? Number(e.target.value) : null)} />
          </div>
        </div>

        {/* Plan */}
        <div className="g1-section">
          <h2 className="g1-section-title">Plan</h2>
          <div className="d4-billing">
            <div className="d4-billing-row"><span>Tier actual</span><span className="d4-billing-value">{plan.toUpperCase()}</span></div>
            <div className="d4-billing-row"><span>Análisis este mes</span><span className="d4-billing-value">{used} / {limit !== null ? limit : "∞"}</span></div>
            <div className="d4-billing-row"><span>Estado</span><span className="d4-billing-value">{org?.access_status as string}</span></div>
          </div>
        </div>

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
