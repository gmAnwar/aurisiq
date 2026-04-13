"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { getRoleLabel } from "../../../lib/roleLabel";
import TrackersCRUD from "../../components/TrackersCRUD";

type ConfigTab = "proceso" | "equipo" | "preferencias" | "cuenta";

interface FunnelStage { id: string; name: string; stage_type: string; order_index: number; scorecard_id: string | null; }
interface StageChecklistItem { id: string; funnel_stage_id: string; label: string; description: string | null; sort_order: number; active: boolean; }
interface DescalCat { id: string; code: string; label: string; active: boolean; }
interface LeadSrc { id: string; name: string; cost_per_lead: number | null; active: boolean; }
interface VocabItem { term: string; definition: string; }
interface Objective { id: string; name: string; type: string; target_value: number; period_type: string; is_active: boolean; target_user_id: string | null; }

export default function ConfigPageWrapper() {
  return (
    <Suspense fallback={<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /></div></div>}>
      <ConfigPage />
    </Suspense>
  );
}

function ConfigPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as ConfigTab) || "proceso";
  const setTab = (tab: ConfigTab) => router.push(`/equipo/config?tab=${tab}`, { scroll: false });

  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [descalCats, setDescalCats] = useState<DescalCat[]>([]);
  const [leadSrcs, setLeadSrcs] = useState<LeadSrc[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [vocabulary, setVocabulary] = useState<VocabItem[]>([]);
  const [newVocabTerm, setNewVocabTerm] = useState("");
  const [newVocabDef, setNewVocabDef] = useState("");
  const [savingVocab, setSavingVocab] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatLabel, setEditCatLabel] = useState("");
  const [editingSrcId, setEditingSrcId] = useState<string | null>(null);
  const [editSrcName, setEditSrcName] = useState("");
  const [editSrcCost, setEditSrcCost] = useState("");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newSrcName, setNewSrcName] = useState("");
  const [newSrcCost, setNewSrcCost] = useState("");
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
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const [stageItems, setStageItems] = useState<Record<string, StageChecklistItem[]>>({});
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState("llamada");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);
      setUserId(session.userId);
      setOrgSlug(session.organizationSlug);
      setRoleLabelVendedor(session.roleLabelVendedor);

      const [stagesRes, catsRes, srcsRes, orgRes, objRes, funnelRes, capsRes] = await Promise.all([
        supabase.from("funnel_stages").select("id, name, stage_type, order_index, scorecard_id")
          .eq("organization_id", session.organizationId).order("order_index"),
        supabase.from("descalification_categories").select("id, code, label, active")
          .eq("organization_id", session.organizationId).order("label"),
        supabase.from("lead_sources").select("id, name, cost_per_lead, active")
          .eq("organization_id", session.organizationId).order("name"),
        supabase.from("organizations").select("plan, analysis_count_month, access_status, ticket_promedio, conversion_baseline, vocabulary")
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
      if (orgRes.data && Array.isArray(orgRes.data.vocabulary)) {
        setVocabulary(orgRes.data.vocabulary as VocabItem[]);
      }
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

  // --- Stages ---
  const addStage = async () => {
    if (!newStageName.trim() || !orgId) return;
    const maxIdx = stages.reduce((m, s) => Math.max(m, s.order_index), 0);
    const { data } = await supabase.from("funnel_stages")
      .insert({ organization_id: orgId, name: newStageName.trim(), stage_type: newStageType, order_index: maxIdx + 1 })
      .select("id, name, stage_type, order_index, scorecard_id").single();
    if (data) setStages(prev => [...prev, data as FunnelStage]);
    setNewStageName(""); setNewStageType("llamada");
  };

  const deleteStage = async (stageId: string) => {
    if (!confirm("¿Eliminar esta etapa? Se eliminarán también sus items de checklist. Los análisis históricos se preservan.")) return;
    await supabase.from("funnel_stages").update({ active: false }).eq("id", stageId);
    setStages(prev => prev.filter(s => s.id !== stageId));
  };

  const loadStageItems = async (stageId: string) => {
    if (stageItems[stageId]) return;
    const { data } = await supabase.from("stage_checklist_items")
      .select("id, funnel_stage_id, label, description, sort_order, active")
      .eq("funnel_stage_id", stageId).order("sort_order");
    setStageItems(prev => ({ ...prev, [stageId]: (data || []) as StageChecklistItem[] }));
  };

  const toggleExpand = async (stageId: string) => {
    if (expandedStageId === stageId) { setExpandedStageId(null); return; }
    setExpandedStageId(stageId);
    await loadStageItems(stageId);
  };

  const addChecklistItem = async (stageId: string) => {
    if (!newItemLabel.trim() || !orgId) return;
    const items = stageItems[stageId] || [];
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { data } = await supabase.from("stage_checklist_items")
      .insert({ funnel_stage_id: stageId, organization_id: orgId, label: newItemLabel.trim(), description: newItemDesc.trim() || null, sort_order: maxSort + 1 })
      .select("id, funnel_stage_id, label, description, sort_order, active").single();
    if (data) setStageItems(prev => ({ ...prev, [stageId]: [...(prev[stageId] || []), data as StageChecklistItem] }));
    setNewItemLabel(""); setNewItemDesc("");
  };

  const toggleChecklistItem = async (stageId: string, itemId: string, currentActive: boolean) => {
    await supabase.from("stage_checklist_items").update({ active: !currentActive }).eq("id", itemId);
    setStageItems(prev => ({ ...prev, [stageId]: (prev[stageId] || []).map(i => i.id === itemId ? { ...i, active: !currentActive } : i) }));
  };

  const deleteChecklistItem = async (stageId: string, itemId: string) => {
    await supabase.from("stage_checklist_items").delete().eq("id", itemId);
    setStageItems(prev => ({ ...prev, [stageId]: (prev[stageId] || []).filter(i => i.id !== itemId) }));
  };

  // --- Vocabulary ---
  const saveVocabulary = async (updated: VocabItem[]) => {
    setSavingVocab(true);
    await supabase.from("organizations").update({ vocabulary: updated }).eq("id", orgId);
    setVocabulary(updated);
    setSavingVocab(false);
  };

  const addVocabItem = async () => {
    if (!newVocabTerm.trim() || !newVocabDef.trim()) return;
    const updated = [...vocabulary, { term: newVocabTerm.trim(), definition: newVocabDef.trim() }];
    await saveVocabulary(updated);
    setNewVocabTerm("");
    setNewVocabDef("");
  };

  const removeVocabItem = async (idx: number) => {
    await saveVocabulary(vocabulary.filter((_, i) => i !== idx));
  };

  // --- Categories ---
  const toggleCat = async (catId: string, currentActive: boolean) => {
    await supabase.from("descalification_categories").update({ active: !currentActive }).eq("id", catId);
    setDescalCats(prev => prev.map(c => c.id === catId ? { ...c, active: !currentActive } : c));
  };

  const addCategory = async () => {
    if (!newCatLabel.trim()) return;
    const code = newCatLabel.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
    if (descalCats.some(c => c.code === code)) return;
    const { data } = await supabase.from("descalification_categories")
      .insert({ organization_id: orgId, code, label: newCatLabel.trim(), active: true })
      .select("id, code, label, active").single();
    if (data) setDescalCats(prev => [...prev, data]);
    setNewCatLabel("");
  };

  const saveCatLabel = async (catId: string) => {
    if (!editCatLabel.trim()) { setEditingCatId(null); return; }
    await supabase.from("descalification_categories").update({ label: editCatLabel.trim() }).eq("id", catId);
    setDescalCats(prev => prev.map(c => c.id === catId ? { ...c, label: editCatLabel.trim() } : c));
    setEditingCatId(null);
  };

  // --- Lead sources ---
  const toggleSource = async (srcId: string, currentActive: boolean) => {
    await supabase.from("lead_sources").update({ active: !currentActive }).eq("id", srcId);
    setLeadSrcs(prev => prev.map(s => s.id === srcId ? { ...s, active: !currentActive } : s));
  };

  const addSource = async () => {
    if (!newSrcName.trim()) return;
    const cost = newSrcCost ? Number(newSrcCost) : null;
    const { data } = await supabase.from("lead_sources")
      .insert({ organization_id: orgId, name: newSrcName.trim(), cost_per_lead: cost, active: true })
      .select("id, name, cost_per_lead, active").single();
    if (data) setLeadSrcs(prev => [...prev, data as LeadSrc]);
    setNewSrcName("");
    setNewSrcCost("");
  };

  const saveSrcEdit = async (srcId: string) => {
    if (!editSrcName.trim()) { setEditingSrcId(null); return; }
    const cost = editSrcCost ? Number(editSrcCost) : null;
    await supabase.from("lead_sources").update({ name: editSrcName.trim(), cost_per_lead: cost }).eq("id", srcId);
    setLeadSrcs(prev => prev.map(s => s.id === srcId ? { ...s, name: editSrcName.trim(), cost_per_lead: cost } : s));
    setEditingSrcId(null);
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
    const vendedorLabel = getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor });
    const capName = captadoras.find(c => c.id === indivCaptadora)?.name || vendedorLabel;

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

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border, #e5e5e5)", marginBottom: 16, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {([
            { key: "proceso" as ConfigTab, label: "Proceso de venta" },
            { key: "equipo" as ConfigTab, label: "Equipo" },
            { key: "preferencias" as ConfigTab, label: "Preferencias" },
            { key: "cuenta" as ConfigTab, label: "Cuenta" },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: activeTab === t.key ? 600 : 400,
                color: activeTab === t.key ? "var(--ink)" : "var(--ink-light, #737373)",
                background: "none",
                border: "none",
                borderBottom: activeTab === t.key ? "2px solid var(--accent, #4f46e5)" : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "proceso" && <>
        {/* Etapas del embudo */}
        <div className="g1-section">
          <h2 className="g1-section-title">Etapas del embudo</h2>
          <p className="c2-hint" style={{ marginBottom: 10 }}>Cada etapa tiene su checklist de datos que la IA evalúa en cada llamada.</p>
          {stages.length > 0 ? (
            <div className="g7-list">
              {stages.map(s => (
                <div key={s.id}>
                  <div className="g7-list-item">
                    <div style={{ flex: 1, cursor: "pointer" }} onClick={() => toggleExpand(s.id)}>
                      <span className="g7-item-name">{expandedStageId === s.id ? "▼" : "▶"} {s.name}</span>
                      <span className="g7-item-code" style={{ marginLeft: 8 }}>{s.stage_type}</span>
                      {stageItems[s.id] && <span style={{ fontSize: 11, color: "var(--ink-light)", marginLeft: 6 }}>({stageItems[s.id].filter(i => i.active).length} items)</span>}
                    </div>
                    <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 12 }} onClick={() => deleteStage(s.id)}>Archivar</button>
                  </div>
                  {expandedStageId === s.id && (
                    <div style={{ paddingLeft: 24, paddingBottom: 12, borderLeft: "2px solid var(--border, #e5e5e5)", marginLeft: 12, marginBottom: 8 }}>
                      {(stageItems[s.id] || []).map(item => (
                        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", opacity: item.active ? 1 : 0.4 }}>
                          <div>
                            <span style={{ fontSize: 13 }}>{item.label}</span>
                            {item.description && <span style={{ fontSize: 11, color: "var(--ink-light)", marginLeft: 6 }}>{item.description}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <label className="g7-toggle" style={{ transform: "scale(0.8)" }}>
                              <input type="checkbox" checked={item.active} onChange={() => toggleChecklistItem(s.id, item.id, item.active)} />
                              <span className="g7-toggle-slider" />
                            </label>
                            <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 11 }} onClick={() => deleteChecklistItem(s.id, item.id)}>x</button>
                          </div>
                        </div>
                      ))}
                      {(!stageItems[s.id] || stageItems[s.id].length === 0) && <p style={{ fontSize: 12, color: "var(--ink-light)", margin: "4px 0" }}>Sin items de checklist.</p>}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                        <input className="input-field" style={{ flex: 1, fontSize: 12, padding: "4px 8px", minWidth: 120 }} value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)} placeholder="Nuevo item..." />
                        <input className="input-field" style={{ flex: 1, fontSize: 12, padding: "4px 8px", minWidth: 120 }} value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} placeholder="Descripción (opcional)" />
                        <button className="g4-note-save" style={{ fontSize: 11 }} onClick={() => addChecklistItem(s.id)} disabled={!newItemLabel.trim()}>+ Item</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="g1-empty">No hay etapas configuradas.</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
            <input className="input-field" value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Nueva etapa..." style={{ flex: 1 }} />
            <select className="input-field" value={newStageType} onChange={e => setNewStageType(e.target.value)} style={{ width: 110 }}>
              <option value="llamada">Llamada</option><option value="visita">Visita</option><option value="cierre">Cierre</option>
            </select>
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addStage} disabled={!newStageName.trim()}>Agregar etapa</button>
          </div>
        </div>

        {/* Vocabulario de la organización */}
        <div className="g1-section">
          <h2 className="g1-section-title">Vocabulario</h2>
          <p className="c2-hint" style={{ marginBottom: 10 }}>Términos específicos de tu vertical. La IA los usará tal como los definas al analizar llamadas.</p>
          {vocabulary.length > 0 && (
            <div className="g7-list">
              {vocabulary.map((v, i) => (
                <div key={i} className="g7-list-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <span className="g7-item-name">{v.term}</span>
                    <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 12 }} onClick={() => removeVocabItem(i)}>Quitar</button>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--ink-light)" }}>{v.definition}</span>
                </div>
              ))}
            </div>
          )}
          {vocabulary.length === 0 && <p className="g1-empty" style={{ marginBottom: 10 }}>Sin términos. La IA usará vocabulario genérico.</p>}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <input className="input-field" value={newVocabTerm} onChange={e => setNewVocabTerm(e.target.value)} placeholder="Término" />
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <input className="input-field" value={newVocabDef} onChange={e => setNewVocabDef(e.target.value)} placeholder="Definición" />
            </div>
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addVocabItem} disabled={savingVocab || !newVocabTerm.trim() || !newVocabDef.trim()}>
              {savingVocab ? "..." : "Agregar"}
            </button>
          </div>
        </div>

        {/* Catálogo de Descalificación */}
        <div className="g1-section">
          <h2 className="g1-section-title">Catálogo de descalificación</h2>
          <p className="c2-hint" style={{ marginBottom: 10 }}>La IA usa estos códigos para clasificar leads descartados. El código es inmutable; la etiqueta es editable.</p>
          <div className="g7-list">
            {descalCats.map(c => (
              <div key={c.id} className="g7-list-item">
                <div style={{ flex: 1 }}>
                  {editingCatId === c.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input className="input-field" style={{ fontSize: 13, padding: "4px 8px" }} value={editCatLabel} onChange={e => setEditCatLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && saveCatLabel(c.id)} autoFocus />
                      <button className="g4-note-save" style={{ fontSize: 12 }} onClick={() => saveCatLabel(c.id)}>OK</button>
                      <button className="g4-note-cancel" style={{ fontSize: 12 }} onClick={() => setEditingCatId(null)}>X</button>
                    </div>
                  ) : (
                    <span className="g7-item-name" style={{ cursor: "pointer" }} onClick={() => { setEditingCatId(c.id); setEditCatLabel(c.label); }}>{c.label}</span>
                  )}
                  <span className="g7-item-code">{c.code}</span>
                </div>
                <label className="g7-toggle">
                  <input type="checkbox" checked={c.active} onChange={() => toggleCat(c.id, c.active)} />
                  <span className="g7-toggle-slider" />
                </label>
              </div>
            ))}
          </div>
          {descalCats.length === 0 && <p className="g1-empty" style={{ marginBottom: 10 }}>Sin categorías. La IA no podrá clasificar leads descartados.</p>}
          <div className="g7-add-row">
            <input className="input-field" value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nueva categoría..." onKeyDown={e => e.key === "Enter" && addCategory()} />
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addCategory} disabled={!newCatLabel.trim()}>Agregar</button>
          </div>
        </div>

        {/* Trackers de conversación */}
        <div className="g1-section">
          <h2 className="g1-section-title">Trackers de conversación</h2>
          <p className="c2-hint" style={{ marginBottom: 10 }}>Define qué fragmentos busca la IA en cada llamada. Los del sistema aplican a todas las organizaciones.</p>
          <TrackersCRUD orgId={orgId} showUniversals={true} readOnlyUniversals={true} />
        </div>
        </>}

        {activeTab === "equipo" && <>
        {/* Fuentes de Lead */}
        <div className="g1-section">
          <h2 className="g1-section-title">Fuentes de lead</h2>
          <p className="c2-hint" style={{ marginBottom: 10 }}>Las captadoras seleccionan la fuente al registrar cada llamada. El costo por lead es opcional y se usa en reportes de ROI.</p>
          <div className="g7-list">
            {leadSrcs.map(s => (
              <div key={s.id} className="g7-list-item">
                <div style={{ flex: 1 }}>
                  {editingSrcId === s.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input className="input-field" style={{ fontSize: 13, padding: "4px 8px", flex: 1, minWidth: 120 }} value={editSrcName} onChange={e => setEditSrcName(e.target.value)} autoFocus />
                      <input className="input-field" style={{ fontSize: 13, padding: "4px 8px", width: 90 }} type="number" value={editSrcCost} onChange={e => setEditSrcCost(e.target.value)} placeholder="$/lead" />
                      <button className="g4-note-save" style={{ fontSize: 12 }} onClick={() => saveSrcEdit(s.id)}>OK</button>
                      <button className="g4-note-cancel" style={{ fontSize: 12 }} onClick={() => setEditingSrcId(null)}>X</button>
                    </div>
                  ) : (
                    <span className="g7-item-name" style={{ cursor: "pointer" }} onClick={() => { setEditingSrcId(s.id); setEditSrcName(s.name); setEditSrcCost(s.cost_per_lead?.toString() || ""); }}>
                      {s.name}
                      {s.cost_per_lead != null && <span style={{ fontSize: 12, color: "var(--ink-light)", marginLeft: 6 }}>${s.cost_per_lead}/lead</span>}
                    </span>
                  )}
                </div>
                <label className="g7-toggle">
                  <input type="checkbox" checked={s.active} onChange={() => toggleSource(s.id, s.active)} />
                  <span className="g7-toggle-slider" />
                </label>
              </div>
            ))}
          </div>
          {leadSrcs.length === 0 && <p className="g1-empty" style={{ marginBottom: 10 }}>Sin fuentes. Las captadoras no podrán registrar llamadas.</p>}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <input className="input-field" value={newSrcName} onChange={e => setNewSrcName(e.target.value)} placeholder="Nueva fuente..." onKeyDown={e => e.key === "Enter" && addSource()} />
            </div>
            <div style={{ width: 100 }}>
              <input className="input-field" type="number" value={newSrcCost} onChange={e => setNewSrcCost(e.target.value)} placeholder="$/lead" />
            </div>
            <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px", marginTop: 0 }} onClick={addSource} disabled={!newSrcName.trim()}>Agregar</button>
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
                        ? ` · ${captadoras.find(c => c.id === o.target_user_id)?.name || getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor })}`
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
              <div className="input-label" style={{ marginBottom: 10 }}>Objetivo individual por {getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor }).toLowerCase()}</div>
              <p className="c2-hint" style={{ marginBottom: 10 }}>
                Si tiene objetivo individual, reemplaza el global en su pantalla Mi Día.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div className="g7-field-row" style={{ flex: 1, minWidth: 150 }}>
                  <label className="input-label">{getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor })}</label>
                  <select className="input-field c2-select" value={indivCaptadora} onChange={e => setIndivCaptadora(e.target.value)}>
                    <option value="">Selecciona {getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor }).toLowerCase()}</option>
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
        </>}

        {activeTab === "preferencias" && <>
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
        </>}

        {activeTab === "cuenta" && <>
        {/* Plan */}
        <div className="g1-section">
          <h2 className="g1-section-title">Plan</h2>
          <div className="d4-billing">
            <div className="d4-billing-row"><span>Tier actual</span><span className="d4-billing-value">{plan.toUpperCase()}</span></div>
            <div className="d4-billing-row"><span>Análisis este mes</span><span className="d4-billing-value">{used} / {limit !== null ? limit : "∞"}</span></div>
            <div className="d4-billing-row"><span>Estado</span><span className="d4-billing-value">{org?.access_status as string}</span></div>
          </div>
        </div>
        </>}

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
