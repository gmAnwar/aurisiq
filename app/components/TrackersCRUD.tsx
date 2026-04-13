"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface Tracker {
  id: string;
  organization_id: string | null;
  code: string;
  label: string;
  icon: string;
  description: string;
  speaker: string;
  sort_order: number;
  active: boolean;
}

interface Props {
  orgId: string | null;
  showUniversals: boolean;
  readOnlyUniversals: boolean;
  onChanged?: () => void;
}

function toSnakeCase(label: string) {
  return label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 50);
}

export default function TrackersCRUD({ orgId, showUniversals, readOnlyUniversals, onChanged }: Props) {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [newIcon, setNewIcon] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSpeaker, setNewSpeaker] = useState("any");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Tracker>>({});
  const [error, setError] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [disabledOverrides, setDisabledOverrides] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase
        .from("conversation_trackers")
        .select("id, organization_id, code, label, icon, description, speaker, sort_order, active");

      if (orgId && showUniversals) {
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
      } else if (orgId) {
        query = query.eq("organization_id", orgId);
      } else {
        query = query.is("organization_id", null);
      }

      const { data } = await query
        .order("organization_id", { ascending: true, nullsFirst: true })
        .order("sort_order");
      setTrackers((data || []) as Tracker[]);

      // Load overrides for universal trackers (which ones this org disabled)
      if (orgId && showUniversals) {
        const { data: overrides } = await supabase
          .from("tracker_org_overrides")
          .select("tracker_id")
          .eq("organization_id", orgId)
          .eq("disabled", true);
        setDisabledOverrides(new Set((overrides || []).map(o => o.tracker_id)));
      } else {
        setDisabledOverrides(new Set());
      }
      setLoading(false);
    })();
  }, [orgId, showUniversals]);

  const universals = trackers.filter(t => t.organization_id === null);
  const customs = trackers.filter(t => t.organization_id !== null);
  // What we show as the editable list depends on context
  const editableList = orgId === null ? universals : customs;
  const insertOrgId = orgId; // null for universals, UUID for org-specific

  const addTracker = async () => {
    setError("");
    const code = toSnakeCase(newLabel);
    if (!newIcon.trim() || newIcon.trim().length > 4) { setError("Icono: 1-4 caracteres (emoji)"); return; }
    if (!newLabel.trim()) { setError("Label es requerido"); return; }
    if (!code || !/^[a-z0-9_]+$/.test(code)) { setError("El label no genera un código válido"); return; }
    if (newDesc.trim().length < 20) { setError("Descripción: mínimo 20 caracteres"); return; }
    if (newDesc.trim().length > 500) { setError("Descripción: máximo 500 caracteres"); return; }

    const existing = trackers.find(t =>
      (insertOrgId === null ? t.organization_id === null : t.organization_id === insertOrgId)
      && t.code === code
    );
    if (existing) { setError(`Ya existe un tracker con código "${code}"`); return; }

    const { data, error: insertErr } = await supabase.from("conversation_trackers")
      .insert({ organization_id: insertOrgId, code, label: newLabel.trim(), icon: newIcon.trim(), description: newDesc.trim(), speaker: newSpeaker, sort_order: 100, active: true })
      .select("id, organization_id, code, label, icon, description, speaker, sort_order, active").single();
    if (insertErr) { setError(insertErr.message.includes("permission") ? "No tienes permiso para crear trackers." : insertErr.message); return; }
    if (data) { setTrackers(prev => [...prev, data as Tracker]); onChanged?.(); }
    setNewIcon(""); setNewLabel(""); setNewDesc(""); setNewSpeaker("any");
  };

  const startEdit = (t: Tracker) => {
    setEditingId(t.id);
    setEditDraft({ label: t.label, icon: t.icon, description: t.description, speaker: t.speaker });
    setError("");
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft.label?.trim() || !editDraft.icon?.trim()) return;
    if ((editDraft.description?.trim().length || 0) < 20) { setError("Descripción: mínimo 20 caracteres"); return; }
    const { error: upErr } = await supabase.from("conversation_trackers").update({
      label: editDraft.label!.trim(), icon: editDraft.icon!.trim(),
      description: editDraft.description!.trim(), speaker: editDraft.speaker,
    }).eq("id", editingId);
    if (upErr) { setError(upErr.message.includes("permission") ? "No tienes permiso para modificar este tracker." : upErr.message); return; }
    setTrackers(prev => prev.map(t => t.id === editingId ? { ...t, label: editDraft.label!.trim(), icon: editDraft.icon!.trim(), description: editDraft.description!.trim(), speaker: editDraft.speaker! } : t));
    setEditingId(null); setError(""); onChanged?.();
  };

  const toggleActive = async (trkId: string, currentActive: boolean) => {
    await supabase.from("conversation_trackers").update({ active: !currentActive }).eq("id", trkId);
    setTrackers(prev => prev.map(t => t.id === trkId ? { ...t, active: !currentActive } : t));
    onChanged?.();
  };

  const deleteTracker = async (t: Tracker) => {
    const isUniversal = t.organization_id === null;
    const msg = isUniversal
      ? "ATENCIÓN: Este es un tracker universal. Al eliminarlo, TODAS las organizaciones dejarán de detectar esta categoría en nuevos análisis. Los análisis históricos conservan los highlights ya generados."
      : "¿Eliminar este tracker? Los análisis históricos conservan los highlights que ya tienen. Los nuevos análisis no incluirán esta categoría.";
    if (!confirm(msg)) return;
    const { error: delErr } = await supabase.from("conversation_trackers").delete().eq("id", t.id);
    if (delErr) { setError(delErr.message.includes("permission") ? "No tienes permiso para eliminar este tracker." : delErr.message); return; }
    setTrackers(prev => prev.filter(x => x.id !== t.id)); onChanged?.();
  };

  const toggleOverride = async (trackerId: string, currentlyDisabled: boolean) => {
    if (!orgId) return;
    if (currentlyDisabled) {
      // Re-enable: delete override or set disabled=false
      await supabase.from("tracker_org_overrides").delete().eq("organization_id", orgId).eq("tracker_id", trackerId);
      setDisabledOverrides(prev => { const n = new Set(prev); n.delete(trackerId); return n; });
    } else {
      // Disable: upsert override
      await supabase.from("tracker_org_overrides").upsert({ organization_id: orgId, tracker_id: trackerId, disabled: true }, { onConflict: "organization_id,tracker_id" });
      setDisabledOverrides(prev => new Set(prev).add(trackerId));
    }
    onChanged?.();
  };

  const renderRow = (t: Tracker, editable: boolean) => (
    <div key={t.id} className="g7-list-item" style={{ opacity: (t.active && !disabledOverrides.has(t.id)) ? 1 : 0.5 }}>
      {editingId === t.id ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input-field" style={{ width: 60, fontSize: 13, padding: "4px 8px", textAlign: "center" }} value={editDraft.icon || ""} onChange={e => setEditDraft({ ...editDraft, icon: e.target.value })} maxLength={4} />
            <input className="input-field" style={{ flex: 1, fontSize: 13, padding: "4px 8px", minWidth: 120 }} value={editDraft.label || ""} onChange={e => setEditDraft({ ...editDraft, label: e.target.value })} />
            <select className="input-field" style={{ width: 100, fontSize: 13, padding: "4px 8px" }} value={editDraft.speaker || "any"} onChange={e => setEditDraft({ ...editDraft, speaker: e.target.value })}>
              <option value="prospect">Prospecto</option><option value="seller">Vendedor</option><option value="any">Cualquiera</option>
            </select>
          </div>
          <textarea className="input-field" rows={2} style={{ fontSize: 13, padding: "4px 8px" }} value={editDraft.description || ""} onChange={e => setEditDraft({ ...editDraft, description: e.target.value })} placeholder="Descripción (mín 20 chars)" />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="g4-note-save" style={{ fontSize: 12 }} onClick={saveEdit}>Guardar</button>
            <button className="g4-note-cancel" style={{ fontSize: 12 }} onClick={() => { setEditingId(null); setError(""); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1 }}>
            <span className="g7-item-name" style={editable ? { cursor: "pointer" } : undefined} onClick={() => editable && startEdit(t)}>{t.icon} {t.label}</span>
            <span className="g7-item-code" style={{ marginLeft: 8 }}>{editable ? t.code : "Sistema"}</span>
          </div>
          {editable ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <label className="g7-toggle"><input type="checkbox" checked={t.active} onChange={() => toggleActive(t.id, t.active)} /><span className="g7-toggle-slider" /></label>
              <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 12 }} onClick={() => deleteTracker(t)}>Eliminar</button>
            </div>
          ) : readOnlyUniversals && orgId && t.organization_id === null ? (
            <label className="g7-toggle" title={disabledOverrides.has(t.id) ? "Desactivado para tu org" : "Activo para tu org"}>
              <input type="checkbox" checked={!disabledOverrides.has(t.id)} onChange={() => toggleOverride(t.id, disabledOverrides.has(t.id))} />
              <span className="g7-toggle-slider" />
            </label>
          ) : null}
        </>
      )}
    </div>
  );

  if (loading) return <p style={{ fontSize: 13, color: "#737373" }}>Cargando trackers...</p>;

  return (
    <div>
      {/* Universals read-only section */}
      {showUniversals && universals.length > 0 && readOnlyUniversals && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-light, #737373)", marginBottom: 6 }}>Del sistema</div>
          <div className="g7-list" style={{ marginBottom: 16 }}>
            {universals.map(t => renderRow(t, false))}
          </div>
        </>
      )}

      {/* Universals editable (admin with orgId=null) */}
      {orgId === null && !readOnlyUniversals && universals.length > 0 && (
        <div className="g7-list" style={{ marginBottom: 12 }}>
          {universals.map(t => renderRow(t, true))}
        </div>
      )}

      {/* Custom trackers */}
      {orgId !== null && (
        <>
          {!showUniversals && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-light, #737373)", marginBottom: 6 }}>Personalizados</div>}
          {showUniversals && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-light, #737373)", marginBottom: 6 }}>Personalizados</div>}
          {customs.length > 0 ? (
            <div className="g7-list" style={{ marginBottom: 12 }}>
              {customs.map(t => renderRow(t, true))}
            </div>
          ) : (
            <p className="g1-empty" style={{ marginBottom: 12 }}>Sin trackers personalizados.</p>
          )}
        </>
      )}

      {error && <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 8 }}>{error}</p>}

      {/* Add form */}
      {(() => {
        const hasInput = !!(newIcon || newLabel || newDesc);
        const errField = hasInput ? (!newIcon.trim() ? "icon" : !newLabel.trim() ? "label" : newDesc.trim().length < 20 ? "desc" : null) : null;
        const errBorder = "2px solid #ef4444";
        return (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ width: 60, position: "relative" }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <input className="input-field" value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="🎯" maxLength={4} style={{ textAlign: "center", flex: 1, ...(errField === "icon" ? { border: errBorder } : {}) }} />
                  <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} style={{ background: "none", border: "1px solid var(--border, #d1d5db)", borderRadius: 4, cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1 }} title="Elegir emoji">▼</button>
                </div>
                {showEmojiPicker && (
                  <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, background: "white", border: "1px solid var(--border, #d1d5db)", borderRadius: 8, padding: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", width: 240, marginTop: 4 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                      {["💰","💵","💳","📊","📈","💎","🏦","⏰","⏱️","📅","🗓️","🔔","⌛","🕐","👥","👤","👔","🤝","👋","🙋","💪","📄","📋","📝","✅","❌","📎","🗂️","📍","🏠","🏢","🏪","🏗️","🌎","🗺️","📞","💬","📧","❓","💡","🔑","🎯","🚫","⚠️","🔴","🟡","🟢","🛠️"].map(e => (
                        <button key={e} type="button" onClick={() => { setNewIcon(e); setShowEmojiPicker(false); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, borderRadius: 4, lineHeight: 1 }} onMouseOver={ev => (ev.currentTarget.style.background = "#f3f4f6")} onMouseOut={ev => (ev.currentTarget.style.background = "none")}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <input className="input-field" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Nombre del tracker" style={errField === "label" ? { border: errBorder } : {}} />
              </div>
              <div style={{ width: 110 }}>
                <select className="input-field" value={newSpeaker} onChange={e => setNewSpeaker(e.target.value)}>
                  <option value="prospect">Prospecto</option><option value="seller">Vendedor</option><option value="any">Cualquiera</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <textarea className="input-field" rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descripción para la IA (mín 20 caracteres)" style={{ width: "100%", ...(errField === "desc" ? { border: errBorder } : {}) }} />
            </div>
            <div style={{ marginTop: 6 }}>
              <button className="btn-submit" style={{ minWidth: "auto", padding: "10px 20px" }} onClick={addTracker} disabled={!newLabel.trim() || !newIcon.trim() || newDesc.trim().length < 20}>
                Agregar tracker
              </button>
              {newLabel.trim() && <span style={{ fontSize: 12, color: "var(--ink-light, #737373)", marginLeft: 8 }}>Código: {toSnakeCase(newLabel)}</span>}
              {errField && (
                <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>
                  {errField === "icon" ? "Falta icono (emoji)" : errField === "label" ? "Falta nombre del tracker" : `Descripción: ${newDesc.trim().length}/20 caracteres mínimo`}
                </p>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}
