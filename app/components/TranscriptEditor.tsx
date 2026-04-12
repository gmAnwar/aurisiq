"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeEditPercentage } from "../../lib/text";

interface Props {
  analysisId: string;
  transcriptionText: string;
  transcriptionOriginal: string | null;
  editPercentage: number;
  showEditBadge: boolean;
  onSaved?: (newText: string, newPct: number) => void;
}

export default function TranscriptEditor({
  analysisId,
  transcriptionText,
  transcriptionOriginal,
  editPercentage,
  showEditBadge,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(transcriptionText);
  const [saving, setSaving] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [currentText, setCurrentText] = useState(transcriptionText);
  const [currentPct, setCurrentPct] = useState(editPercentage);

  const startEdit = () => {
    setDraft(currentText);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
  };

  const save = async () => {
    if (draft === currentText) { setEditing(false); return; }
    setSaving(true);

    const original = transcriptionOriginal || transcriptionText;
    const pct = computeEditPercentage(original, draft);

    const { error } = await supabase
      .from("analysis_jobs")
      .update({ transcription_edited: draft, edit_percentage: pct })
      .eq("analysis_id", analysisId);

    if (error) {
      alert("Error al guardar: " + error.message);
      setSaving(false);
      return;
    }

    setCurrentText(draft);
    setCurrentPct(pct);
    setEditing(false);
    setSaving(false);
    onSaved?.(draft, pct);
  };

  return (
    <div className="g1-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 className="g1-section-title" style={{ margin: 0 }}>Transcripcion</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {showEditBadge && currentPct > 0 && (
            <span
              className={`g3-edit-badge ${currentPct > 10 ? "g3-edit-badge-high" : "g3-edit-badge-low"}`}
              title={currentPct > 10 ? "Revisar �� alta divergencia vs transcripcion original" : undefined}
            >
              Editada {Math.round(currentPct * 10) / 10}%
            </span>
          )}
          {!editing && (
            <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={startEdit}>
              Editar transcripcion
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <textarea
            className="input-field"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={16}
            style={{ fontSize: 13, lineHeight: 1.6, width: "100%", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="g4-note-save" onClick={save} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button className="g4-note-cancel" onClick={cancel} disabled={saving}>Cancelar</button>
          </div>
        </>
      ) : (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>
          {currentText}
        </div>
      )}

      {currentPct > 0 && transcriptionOriginal && !editing && (
        <>
          <button className="g3-show-original" onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? "Ocultar original" : "Ver original"}
          </button>
          {showOriginal && (
            <div className="g3-original-panel">
              <span className="g3-original-label">Transcripcion original (AssemblyAI)</span>
              <div className="g3-transcription g3-transcription-original">{transcriptionOriginal}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
