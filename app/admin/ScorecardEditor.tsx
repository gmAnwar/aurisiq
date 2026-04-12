"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

interface Criterion { name: string; detail: string; weight: number | null; }
interface Phase {
  name: string;
  max_score: number;
  prompt_base: string;
  criteria: Criterion[];
  fields?: string[];
}
interface OutputBlock { key: string; description: string; format_instruction: string; }
interface Structure {
  objective?: string;
  context?: string;
  tone?: string;
  phases?: Phase[];
  output_blocks?: OutputBlock[];
  checklist_fields?: { slug: string; label: string }[];
  prospect_fields?: { key: string; instruction: string; maps_to: string }[];
  extraction_patterns?: { key: string; regex: string; column: string }[];
}

interface Props {
  scorecardId: string;
  scorecardName: string;
  initialStructure: Structure;
  onClose: () => void;
  onSaved: () => void;
}

export default function ScorecardEditor({ scorecardId, scorecardName, initialStructure, onClose, onSaved }: Props) {
  const [structure, setStructure] = useState<Structure>(() => ({
    objective: initialStructure.objective || "",
    context: initialStructure.context || "",
    tone: initialStructure.tone || "",
    phases: (initialStructure.phases || []).map(p => ({ ...p, criteria: [...(p.criteria || [])] })),
    output_blocks: [...(initialStructure.output_blocks || [])],
    checklist_fields: initialStructure.checklist_fields || [],
    prospect_fields: initialStructure.prospect_fields || [],
    extraction_patterns: initialStructure.extraction_patterns || [],
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);
  const [showOutputBlocks, setShowOutputBlocks] = useState(false);

  const phases = structure.phases || [];

  function updatePhase(idx: number, patch: Partial<Phase>) {
    const next = [...phases];
    next[idx] = { ...next[idx], ...patch };
    setStructure({ ...structure, phases: next });
    setSaved(false);
  }

  function addPhase() {
    const next = [...phases, { name: "Nueva fase", max_score: 10, prompt_base: "", criteria: [], fields: [] }];
    setStructure({ ...structure, phases: next });
    setExpandedPhase(next.length - 1);
    setSaved(false);
  }

  function removePhase(idx: number) {
    const next = phases.filter((_, i) => i !== idx);
    setStructure({ ...structure, phases: next });
    setExpandedPhase(null);
    setSaved(false);
  }

  function movePhase(idx: number, dir: "up" | "down") {
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= phases.length) return;
    const next = [...phases];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setStructure({ ...structure, phases: next });
    setExpandedPhase(swap);
    setSaved(false);
  }

  function updateCriterion(phaseIdx: number, critIdx: number, patch: Partial<Criterion>) {
    const next = [...phases];
    const crit = [...next[phaseIdx].criteria];
    crit[critIdx] = { ...crit[critIdx], ...patch };
    next[phaseIdx] = { ...next[phaseIdx], criteria: crit };
    setStructure({ ...structure, phases: next });
    setSaved(false);
  }

  function addCriterion(phaseIdx: number) {
    const next = [...phases];
    next[phaseIdx] = { ...next[phaseIdx], criteria: [...next[phaseIdx].criteria, { name: "", detail: "", weight: null }] };
    setStructure({ ...structure, phases: next });
    setSaved(false);
  }

  function removeCriterion(phaseIdx: number, critIdx: number) {
    const next = [...phases];
    next[phaseIdx] = { ...next[phaseIdx], criteria: next[phaseIdx].criteria.filter((_, i) => i !== critIdx) };
    setStructure({ ...structure, phases: next });
    setSaved(false);
  }

  function updateOutputBlock(idx: number, patch: Partial<OutputBlock>) {
    const blocks = [...(structure.output_blocks || [])];
    blocks[idx] = { ...blocks[idx], ...patch };
    setStructure({ ...structure, output_blocks: blocks });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("scorecards")
      .update({ structure })
      .eq("id", scorecardId);
    setSaving(false);
    if (error) {
      alert("Error guardando: " + error.message);
    } else {
      setSaved(true);
      onSaved();
    }
  }

  const totalScore = phases.reduce((s, p) => s + (p.max_score || 0), 0);

  return (
    <div style={{ padding: "16px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{scorecardName}</h3>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#737373" }}>Scorecard ID: {scorecardId.slice(0, 8)}…</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="adm-btn-primary" onClick={handleSave} disabled={saving || saved}>
            {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar cambios"}
          </button>
          <button className="adm-btn-ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>

      {/* Objective / Context / Tone */}
      <details open style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 0", color: "var(--ink-light, #666)" }}>
          Contexto general
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#737373" }}>Objetivo</label>
            <textarea className="input-field" rows={2} value={structure.objective || ""} onChange={e => { setStructure({ ...structure, objective: e.target.value }); setSaved(false); }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#737373" }}>Contexto</label>
            <textarea className="input-field" rows={3} value={structure.context || ""} onChange={e => { setStructure({ ...structure, context: e.target.value }); setSaved(false); }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#737373" }}>Tono</label>
            <textarea className="input-field" rows={2} value={structure.tone || ""} onChange={e => { setStructure({ ...structure, tone: e.target.value }); setSaved(false); }} />
          </div>
        </div>
      </details>

      {/* Phases */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-light, #666)" }}>
          Fases ({phases.length}) — Total: {totalScore}/100
        </span>
        <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={addPhase}>+ Agregar fase</button>
      </div>

      {totalScore !== 100 && (
        <div style={{ padding: "6px 10px", background: "#fef3c7", borderRadius: 6, fontSize: 12, color: "#92400e", marginBottom: 8 }}>
          El total de max_score es {totalScore}, debería ser 100.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {phases.map((phase, pi) => (
          <details key={pi} open={expandedPhase === pi} onToggle={e => { if ((e.target as HTMLDetailsElement).open) setExpandedPhase(pi); }}>
            <summary style={{ cursor: "pointer", padding: "8px 10px", background: "var(--surface, #fafafa)", borderRadius: 6, fontSize: 13, fontWeight: 500, display: "flex", justifyContent: "space-between", alignItems: "center", listStyle: "none" }}>
              <span>{phase.name} ({phase.max_score}pts)</span>
              <span style={{ display: "flex", gap: 4 }}>
                <button className="adm-btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={e => { e.preventDefault(); movePhase(pi, "up"); }} disabled={pi === 0}>▲</button>
                <button className="adm-btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={e => { e.preventDefault(); movePhase(pi, "down"); }} disabled={pi === phases.length - 1}>▼</button>
                <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 11, padding: "2px 6px" }} onClick={e => { e.preventDefault(); if (confirm(`¿Eliminar fase "${phase.name}"?`)) removePhase(pi); }}>✕</button>
              </span>
            </summary>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#737373" }}>Nombre</label>
                  <input className="input-field" value={phase.name} onChange={e => updatePhase(pi, { name: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#737373" }}>Max score</label>
                  <input className="input-field" type="number" value={phase.max_score} onChange={e => updatePhase(pi, { max_score: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#737373" }}>Prompt base</label>
                <textarea className="input-field" rows={4} value={phase.prompt_base} onChange={e => updatePhase(pi, { prompt_base: e.target.value })} style={{ fontSize: 12 }} />
              </div>

              {/* Criteria */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: "#737373", fontWeight: 600 }}>Criterios ({phase.criteria.length})</label>
                  <button className="adm-btn-ghost" style={{ fontSize: 11 }} onClick={() => addCriterion(pi)}>+ Criterio</button>
                </div>
                {phase.criteria.map((c, ci) => (
                  <div key={ci} style={{ display: "grid", gridTemplateColumns: "140px 1fr 32px", gap: 4, marginBottom: 4, alignItems: "start" }}>
                    <input className="input-field" value={c.name} placeholder="nombre" onChange={e => updateCriterion(pi, ci, { name: e.target.value })} style={{ fontSize: 12 }} />
                    <input className="input-field" value={c.detail} placeholder="detalle" onChange={e => updateCriterion(pi, ci, { detail: e.target.value })} style={{ fontSize: 12 }} />
                    <button className="adm-icon-btn adm-icon-danger" onClick={() => removeCriterion(pi, ci)} title="Quitar" style={{ width: 28, height: 28 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>

      {/* Output blocks */}
      <details style={{ marginTop: 12 }} open={showOutputBlocks} onToggle={e => setShowOutputBlocks((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 0", color: "var(--ink-light, #666)" }}>
          Output blocks ({(structure.output_blocks || []).length})
        </summary>
        <div style={{ padding: "8px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {(structure.output_blocks || []).map((b, bi) => (
            <div key={bi} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4 }}>
              <div>
                <label style={{ fontSize: 11, color: "#737373" }}>Key</label>
                <input className="input-field" value={b.key} onChange={e => updateOutputBlock(bi, { key: e.target.value })} style={{ fontSize: 12 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#737373" }}>Format instruction</label>
                <input className="input-field" value={b.format_instruction} onChange={e => updateOutputBlock(bi, { format_instruction: e.target.value })} style={{ fontSize: 12 }} />
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
