"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { computeEditPercentage } from "../../lib/text";

interface EditLogRow {
  id: string;
  user_id: string;
  edit_percentage: number;
  created_at: string;
  previous_text: string;
  new_text: string;
  user_name?: string;
}

interface Highlight {
  type: string;
  snippet: string;
  description: string;
}

interface Props {
  analysisId: string;
  transcriptionText: string;
  transcriptionOriginal: string | null;
  editPercentage: number;
  showEditBadge: boolean;
  showEditHistory: boolean;
  userId: string;
  highlights?: Highlight[];
  onSaved?: (newText: string, newPct: number) => void;
}

export default function TranscriptEditor({
  analysisId,
  transcriptionText,
  transcriptionOriginal,
  editPercentage,
  showEditBadge,
  showEditHistory,
  userId,
  highlights = [],
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(transcriptionText);
  const [saving, setSaving] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [currentText, setCurrentText] = useState(transcriptionText);
  const [currentPct, setCurrentPct] = useState(editPercentage);
  const [editCount, setEditCount] = useState(0);
  const [editLog, setEditLog] = useState<EditLogRow[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [diffIdx, setDiffIdx] = useState<number | null>(null);

  // Load edit count + history
  useEffect(() => {
    (async () => {
      try {
        // Get analysis_job_id first
        const { data: job } = await supabase
          .from("analysis_jobs").select("id").eq("analysis_id", analysisId).maybeSingle();
        if (!job) return;

        const { data: edits } = await supabase
          .from("transcript_edits")
          .select("id, user_id, edit_percentage, created_at, previous_text, new_text")
          .eq("analysis_job_id", job.id)
          .order("created_at", { ascending: false });

        if (edits) {
          setEditCount(edits.length);
          // Fetch user names for history
          const userIds = [...new Set(edits.map(e => e.user_id))];
          const { data: users } = await supabase
            .from("users").select("id, name").in("id", userIds);
          const nameMap: Record<string, string> = {};
          for (const u of users || []) nameMap[u.id] = u.name;
          setEditLog(edits.map(e => ({ ...e, user_name: nameMap[e.user_id] || "—" })));
        }
      } catch { /* table may not exist yet */ }
    })();
  }, [analysisId, currentPct]);

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

    // Audit log: INSERT before overwriting
    try {
      const { data: job } = await supabase
        .from("analysis_jobs").select("id").eq("analysis_id", analysisId).maybeSingle();
      if (job) {
        await supabase.from("transcript_edits").insert({
          analysis_job_id: job.id,
          user_id: userId,
          previous_text: currentText,
          new_text: draft,
          edit_percentage: pct,
        });
      }
    } catch { /* table may not exist yet — non-blocking */ }

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

  // Build highlighted text segments
  const renderHighlightedText = (text: string) => {
    if (!highlights || highlights.length === 0) return text;

    // Find all matches with positions, avoiding overlaps
    const matches: { start: number; end: number; type: string; description: string }[] = [];
    for (const h of highlights) {
      if (!h.snippet || h.snippet.length < 5) continue;
      const idx = text.indexOf(h.snippet);
      if (idx === -1) continue;
      // Check overlap with existing matches
      const overlaps = matches.some(m => idx < m.end && idx + h.snippet.length > m.start);
      if (overlaps) continue;
      matches.push({ start: idx, end: idx + h.snippet.length, type: h.type, description: h.description });
    }

    if (matches.length === 0) return text;

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    // Build segments
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (cursor < m.start) {
        segments.push(text.slice(cursor, m.start));
      }
      const style = m.type === "momento_critico"
        ? { background: "#fef3c7", borderLeft: "2px solid #f59e0b", paddingLeft: 4, paddingRight: 4 }
        : { background: "#fef2f2", borderLeft: "2px solid #f87171", paddingLeft: 4, paddingRight: 4 };
      segments.push(
        <span key={i} style={style} title={m.description}>
          {text.slice(m.start, m.end)}
        </span>
      );
      cursor = m.end;
    }
    if (cursor < text.length) {
      segments.push(text.slice(cursor));
    }
    return <>{segments}</>;
  };

  return (
    <div className="g1-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 className="g1-section-title" style={{ margin: 0 }}>Transcripción</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {editCount > 0 && (
            <button
              className="g3-edit-badge g3-edit-badge-low"
              style={{ cursor: showEditHistory ? "pointer" : "default", border: "none", background: showEditHistory ? undefined : "var(--bg-muted, #f5f5f4)" }}
              onClick={() => showEditHistory && setShowLog(!showLog)}
              title={showEditHistory ? "Ver historial de ediciones" : undefined}
            >
              Editada {editCount} {editCount === 1 ? "vez" : "veces"}
            </button>
          )}
          {showEditBadge && currentPct > 0 && (
            <span
              className={`g3-edit-badge ${currentPct > 10 ? "g3-edit-badge-high" : "g3-edit-badge-low"}`}
              title={currentPct > 10 ? "Revisar — alta divergencia vs transcripción original" : undefined}
            >
              {Math.round(currentPct * 10) / 10}% vs original
            </span>
          )}
          {!editing && (
            <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={startEdit}>
              Editar transcripción
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
          {renderHighlightedText(currentText)}
        </div>
      )}

      {currentPct > 0 && transcriptionOriginal && !editing && (
        <>
          <button className="g3-show-original" onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? "Ocultar original" : "Ver original"}
          </button>
          {showOriginal && (
            <div className="g3-original-panel">
              <span className="g3-original-label">Transcripción original (AssemblyAI)</span>
              <div className="g3-transcription g3-transcription-original">{transcriptionOriginal}</div>
            </div>
          )}
        </>
      )}

      {/* Edit history — visible to gerente+ */}
      {showLog && showEditHistory && editLog.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border, #e5e5e5)", paddingTop: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Historial de ediciones</h3>
          <div style={{ fontSize: 12 }}>
            {editLog.map((row, i) => (
              <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border, #f0f0f0)" }}>
                <div>
                  <span style={{ fontWeight: 500 }}>{row.user_name}</span>
                  <span style={{ color: "var(--ink-light)", marginLeft: 8 }}>
                    {new Date(row.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    {" "}
                    {new Date(row.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={`g3-edit-badge ${row.edit_percentage > 10 ? "g3-edit-badge-high" : "g3-edit-badge-low"}`} style={{ marginLeft: 8, fontSize: 11 }}>
                    {Math.round(Number(row.edit_percentage) * 10) / 10}%
                  </span>
                </div>
                <button className="adm-btn-ghost" style={{ fontSize: 11 }} onClick={() => setDiffIdx(diffIdx === i ? null : i)}>
                  {diffIdx === i ? "Ocultar" : "Ver cambio"}
                </button>
              </div>
            ))}
          </div>
          {diffIdx !== null && editLog[diffIdx] && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#ef4444" }}>Antes</span>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, background: "#fef2f2", borderRadius: 6, padding: 8, maxHeight: 200, overflow: "auto" }}>
                  {editLog[diffIdx].previous_text}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#22c55e" }}>Después</span>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, background: "#f0fdf4", borderRadius: 6, padding: 8, maxHeight: 200, overflow: "auto" }}>
                  {editLog[diffIdx].new_text}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
