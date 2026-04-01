"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface FunnelStage { id: string; name: string; stage_type: string; order_index: number; scorecard_id: string | null; }
interface DescalCat { id: string; code: string; label: string; active: boolean; }
interface LeadSrc { id: string; name: string; active: boolean; }
interface Objective { id: string; name: string; type: string; target_value: number; period_type: string; is_active: boolean; target_user_id: string | null; }

export default function ConfigPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [descalCats, setDescalCats] = useState<DescalCat[]>([]);
  const [leadSrcs, setLeadSrcs] = useState<LeadSrc[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newSrcName, setNewSrcName] = useState("");
  const [newObjTarget, setNewObjTarget] = useState("");
  const [newObjName, setNewObjName] = useState("Cierres del mes");
  const [captadoras, setCaptadoras] = useState<{ id: string; name: string }[]>([]);
  const [indivCaptadora, setIndivCaptadora] = useState("");
  const [indivTarget, setIndivTarget] = useState("");
  const [emailEquipo, setEmailEquipo] = useState("");
  const [emailAgencia, setEmailAgencia] = useState("");
  const [notifNewAnalysis, setNotifNewAnalysis] = useState(true);
  const [notifWeeklyReport, setNotifWeeklyReport] = useState(true);
  const [notifAlert, setNotifAlert] = useState(true);
  const [notifObjective, setNotifObjective] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);
      setUserId(session.userId);

      const [stagesRes, catsRes, srcsRes, orgRes, objRes, funnelRes, capsRes] = await Promise.all([
        supabase.from("funnel_stages").select("id, name, stage_type, order_index, scorecard_id")
          .eq("organization_id", session.organizationId).order("order_index"),
        supabase.from("descalification_categories").select("id, code, label, active")
          .eq("organization_id", session.organizationId).order("label"),
        supabase.from("lead_sources").select("id, name, active")
          .eq("organization_id", session.organizationId).order("name"),
        supabase.from("organizations").select("plan, analysis_count_month, access_status, ticket_promedio, conversion_baseline")
          .eq("id", session.organizationId).single(),
        supabase.from("objectives").select("id, name, type, target_value, period_type, is_active, target_user_id")
          .eq("organization_id", session.organizationId).order("created_at", { ascending: false }),
        supabase.from("funnel_config").select("report_email_equipo, report_email_agencia")
          .eq("organization_id", session.organizationId).limit(1).single(),
        supabase.from("users").select("id, name").eq("organization_id", session.organizationId)
          .eq("role", "captadora").eq("active", true).order("name"),
      ]);

      setStages(stagesRes.data || []);
      setDescalCats(catsRes.data || []);
      setLeadSrcs(srcsRes.data || []);
      setOrg(orgRes.data);
      setObjectives((objRes.data || []) as Objective[]);
      setCaptadoras(capsRes.data || []);
      if (funnelRes.data) {
        setEmailEquipo((funnelRes.data as Record<string, string>).report_email_equipo || "");
        setEmailAgencia((funnelRes.data as Record<string, string>).report_email_agencia || "");
      }
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

  const addObjective = async () => {
    const target = Number(newObjTarget);
    if (!target || target <= 0 || !newObjName.trim()) return;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    const { data } = await supabase.from("objectives").insert({
      organization_id: orgId,
      created_by: userId,
      target_user_id: null,
      type: "volume",
      name: newObjName.trim(),
      target_value: target,
      period_type: "monthly",
      period_start: periodStart,
      period_end: periodEnd,
      is_active: true,
    }).select("id, name, type, target_value, period_type, is_active, target_user_id").single();

    if (data) setObjectives(prev => [data as Objective, ...prev]);
    setNewObjTarget("");
    setNewObjName("Cierres del mes");
  };

  const addIndividualObjective = async () => {
    const target = Number(indivTarget);
    if (!target || target <= 0 || !indivCaptadora) return;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const capName = captadoras.find(c => c.id === indivCaptadora)?.name || "Captadora";

    const { data } = await supabase.from("objectives").insert({
      organization_id: orgId,
      created_by: userId,
      target_user_id: indivCaptadora,
      type: "volume",
      name: `Meta individual — ${capName}`,
      target_value: target,
      period_type: "monthly",
      period_start: periodStart,
      period_end: periodEnd,
      is_active: true,
    }).select("id, name, type, target_value, period_type, is_active, target_user_id").single();

    if (data) setObjectives(prev => [data as Objective, ...prev]);
    setIndivTarget("");
    setIndivCaptadora("");
  };

  const toggleObjective = async (objId: string, currentActive: boolean) => {
    await supabase.from("objectives").update({ is_active: !currentActive }).eq("id", objId);
    setObjectives(prev => prev.map(o => o.id === objId ? { ...o, is_active: !currentActive } : o));
  };

  const updateOrgField = async (field: string, value: unknown) => {
    await supabase.from("organizations").update({ [field]: value }).eq("id", orgId);
    setOrg(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const saveDestinatario = async (field: string, value: string) => {
    await supabase.from("funnel_config").update({ [field]: value }).eq("organization_id", orgId);
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

        {/* Objetivos del equipo */}
        <div className="g1-section">
          <h2 className="g1-section-title">Objetivos del equipo</h2>
          {objectives.length > 0 && (
            <div className="g7-list">
              {objectives.map(o => (
                <div key={o.id} className="g7-list-item">
                  <div>
                    <span className="g7-item-name">{o.name}</span>
                    <span className="g7-item-code">
                      {o.target_value} {o.type === "volume" ? "cierres" : "pts"} / {o.period_type === "monthly" ? "mes" : o.period_type}
                      {o.target_user_id
                        ? ` · ${captadoras.find(c => c.id === o.target_user_id)?.name || "Captadora"}`
                        : " · Todo el equipo"}
                    </span>
                  </div>
                  <label className="g7-toggle">
                    <input type="checkbox" checked={o.is_active} onChange={() => toggleObjective(o.id, o.is_active)} />
                    <span className="g7-toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
          )}
          {objectives.filter(o => o.is_active && o.type === "volume").length === 0 && (
            <p className="g1-empty" style={{ marginBottom: 12 }}>
              Sin objetivo de volumen activo. Las captadoras verán "Tu gerente aún no ha configurado tu objetivo" en C1.
            </p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="g7-field-row" style={{ flex: 1, minWidth: 150 }}>
              <label className="input-label">Nombre del objetivo</label>
              <input className="input-field" value={newObjName} onChange={e => setNewObjName(e.target.value)} placeholder="Ej: Cierres del mes" />
            </div>
            <div className="g7-field-row" style={{ width: 120 }}>
              <label className="input-label">Meta mensual</label>
              <input className="input-field" type="number" min="1" value={newObjTarget} onChange={e => setNewObjTarget(e.target.value)} placeholder="Ej: 20" />
            </div>
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0, marginBottom: 6 }} onClick={addObjective}>
              Crear objetivo
            </button>
          </div>
          <p className="c2-hint" style={{ marginTop: 8 }}>
            La meta diaria se calcula automáticamente: meta mensual / 22 días hábiles. Las captadoras ven "X llamadas hoy para llegar a Y cierres este mes" en su pantalla Mi Día.
          </p>

          {/* Individual objectives */}
          {captadoras.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div className="input-label" style={{ marginBottom: 10 }}>Objetivo individual por captadora</div>
              <p className="c2-hint" style={{ marginBottom: 10 }}>
                Si una captadora tiene objetivo individual, reemplaza el global en su pantalla Mi Día.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div className="g7-field-row" style={{ flex: 1, minWidth: 150 }}>
                  <label className="input-label">Captadora</label>
                  <select className="input-field c2-select" value={indivCaptadora} onChange={e => setIndivCaptadora(e.target.value)}>
                    <option value="">Selecciona captadora</option>
                    {captadoras.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="g7-field-row" style={{ width: 120 }}>
                  <label className="input-label">Meta mensual</label>
                  <input className="input-field" type="number" min="1" value={indivTarget} onChange={e => setIndivTarget(e.target.value)} placeholder="Ej: 15" />
                </div>
                <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0, marginBottom: 6 }} onClick={addIndividualObjective}>
                  Asignar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Destinatarios */}
        <div className="g1-section">
          <h2 className="g1-section-title">Destinatarios de reportes</h2>
          <div className="g7-field-row" style={{ marginBottom: 12 }}>
            <label className="input-label">Email reporte de equipo (coaching)</label>
            <input
              className="input-field"
              type="email"
              placeholder="gerente@empresa.com"
              value={emailEquipo}
              onChange={e => setEmailEquipo(e.target.value)}
              onBlur={() => saveDestinatario("report_email_equipo", emailEquipo)}
            />
          </div>
          <div className="g7-field-row">
            <label className="input-label">Email reporte de agencia</label>
            <input
              className="input-field"
              type="email"
              placeholder="contacto@agencia.com"
              value={emailAgencia}
              onChange={e => setEmailAgencia(e.target.value)}
              onBlur={() => saveDestinatario("report_email_agencia", emailAgencia)}
            />
          </div>
          <p className="c2-hint" style={{ marginTop: 8 }}>Los reportes se envían automáticamente a estos emails. Se guarda al salir del campo.</p>
        </div>

        {/* Notificaciones */}
        <div className="g1-section">
          <h2 className="g1-section-title">Notificaciones</h2>
          <div className="g7-list">
            <div className="g7-list-item">
              <span className="g7-item-name">Nuevo análisis completado</span>
              <label className="g7-toggle">
                <input type="checkbox" checked={notifNewAnalysis} onChange={() => setNotifNewAnalysis(!notifNewAnalysis)} />
                <span className="g7-toggle-slider" />
              </label>
            </div>
            <div className="g7-list-item">
              <span className="g7-item-name">Reporte semanal generado</span>
              <label className="g7-toggle">
                <input type="checkbox" checked={notifWeeklyReport} onChange={() => setNotifWeeklyReport(!notifWeeklyReport)} />
                <span className="g7-toggle-slider" />
              </label>
            </div>
            <div className="g7-list-item">
              <span className="g7-item-name">Alerta de calidad de leads</span>
              <label className="g7-toggle">
                <input type="checkbox" checked={notifAlert} onChange={() => setNotifAlert(!notifAlert)} />
                <span className="g7-toggle-slider" />
              </label>
            </div>
            <div className="g7-list-item">
              <span className="g7-item-name">Objetivo completado por captadora</span>
              <label className="g7-toggle">
                <input type="checkbox" checked={notifObjective} onChange={() => setNotifObjective(!notifObjective)} />
                <span className="g7-toggle-slider" />
              </label>
            </div>
          </div>
          <p className="c2-hint" style={{ marginTop: 8 }}>Las notificaciones se enviarán por email cuando se active el sistema de Etapa 4.</p>
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
