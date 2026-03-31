"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface ProspectGroup {
  identifier: string;
  entries: {
    id: string;
    created_at: string;
    score_general: number | null;
    clasificacion: string | null;
    avanzo_a_siguiente_etapa: string | null;
    user_id: string;
    manager_note: string | null;
  }[];
}

export default function ExpedientesPage() {
  const [prospects, setProspects] = useState<ProspectGroup[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const [analysesRes, usersRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, prospect_identifier, created_at, score_general, clasificacion, avanzo_a_siguiente_etapa, user_id, manager_note")
          .eq("organization_id", me.organization_id).eq("status", "completado")
          .not("prospect_identifier", "is", null)
          .order("created_at", { ascending: true }),
        supabase.from("users").select("id, name").eq("organization_id", me.organization_id),
      ]);

      const nameMap: Record<string, string> = {};
      for (const u of usersRes.data || []) nameMap[u.id] = u.name;
      setUserNames(nameMap);

      // Group by prospect_identifier
      const groups: Record<string, ProspectGroup> = {};
      for (const a of analysesRes.data || []) {
        const key = a.prospect_identifier || "sin_identificar";
        if (!groups[key]) groups[key] = { identifier: key, entries: [] };
        groups[key].entries.push(a);
      }

      setProspects(Object.values(groups).sort((a, b) => {
        const aLast = a.entries[a.entries.length - 1].created_at;
        const bLast = b.entries[b.entries.length - 1].created_at;
        return bLast.localeCompare(aLast);
      }));

      setLoading(false);
    }
    load();
  }, []);

  const saveNote = async (analysisId: string) => {
    await supabase.from("analyses").update({ manager_note: noteText }).eq("id", analysisId);
    setProspects(prev => prev.map(p => ({
      ...p,
      entries: p.entries.map(e => e.id === analysisId ? { ...e, manager_note: noteText } : e),
    })));
    setEditingNote(null);
  };

  if (loading) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-textarea" />
    </div></div>);
  }

  if (error) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="message-box message-error"><p>{error}</p></div>
    </div></div>);
  }

  const stageLabel: Record<string, string> = {
    converted: "Convertido",
    lost_captadora: "Perdido (captadora)",
    lost_external: "Perdido (externo)",
    pending: "Pendiente",
  };

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Expedientes</h1>
          <p className="g1-subtitle">Seguimiento de prospectos por etapa</p>
        </div>

        {prospects.length === 0 && (
          <p className="g1-empty">No hay prospectos con identificador registrado. Los análisis necesitan un `prospect_identifier` para agruparse aquí.</p>
        )}

        <div className="g4-prospects">
          {prospects.map((p) => {
            const lastEntry = p.entries[p.entries.length - 1];
            const currentStage = lastEntry.avanzo_a_siguiente_etapa || "pending";
            return (
              <div key={p.identifier} className="g4-prospect-card">
                <div className="g4-prospect-header">
                  <span className="g4-prospect-name">{p.identifier}</span>
                  <span className={`g4-stage g4-stage-${currentStage}`}>{stageLabel[currentStage] || currentStage}</span>
                </div>
                <div className="g4-timeline">
                  {p.entries.map((e) => {
                    const date = new Date(e.created_at);
                    return (
                      <div key={e.id} className="g4-timeline-entry">
                        <div className="g4-timeline-dot" />
                        <div className="g4-timeline-content">
                          <div className="g4-timeline-meta">
                            <span>{date.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                            <span>·</span>
                            <span>{userNames[e.user_id] || "—"}</span>
                            {e.score_general !== null && <span>· Score: {e.score_general}</span>}
                          </div>
                          {/* Manager note */}
                          {editingNote === e.id ? (
                            <div className="g4-note-edit">
                              <textarea className="input-field" rows={2} value={noteText} onChange={(ev) => setNoteText(ev.target.value)} placeholder="Nota del gerente..." />
                              <div className="g4-note-actions">
                                <button className="g4-note-save" onClick={() => saveNote(e.id)}>Guardar</button>
                                <button className="g4-note-cancel" onClick={() => setEditingNote(null)}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <div className="g4-note-display" onClick={() => { setEditingNote(e.id); setNoteText(e.manager_note || ""); }}>
                              {e.manager_note ? <p className="g4-note-text">{e.manager_note}</p> : <p className="g4-note-placeholder">Agregar nota...</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
