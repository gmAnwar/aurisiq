"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface SpeechPhase {
  phase_name: string;
  phrases: string[];
}

export default function BibliotecaPage() {
  const [phases, setPhases] = useState<SpeechPhase[]>([]);
  const [editing, setEditing] = useState(false);
  const [editPhases, setEditPhases] = useState<SpeechPhase[]>([]);
  const [versionNum, setVersionNum] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ name: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };
      setOrgId(me.organization_id);

      const { data: sc } = await supabase.from("scorecards").select("id, phases, name")
        .or(`organization_id.eq.${me.organization_id},organization_id.is.null`)
        .eq("active", true).order("organization_id", { ascending: false, nullsFirst: false }).limit(1).single();

      if (!sc) { setLoading(false); return; }
      setScorecardId(sc.id);

      // Get published speech version
      const { data: sv } = await supabase.from("speech_versions")
        .select("id, content, version_number, updated_at")
        .eq("scorecard_id", sc.id).eq("published", true).limit(1).single();

      const scorecardPhases = (sc.phases || []) as { phase_name: string }[];

      if (sv && sv.content) {
        const content = sv.content as Record<string, string[]>;
        const phaseList: SpeechPhase[] = scorecardPhases.map(sp => ({
          phase_name: sp.phase_name,
          phrases: content[sp.phase_name] || [],
        }));
        setPhases(phaseList);
        setVersionNum(sv.version_number);
        setUpdatedAt(sv.updated_at);
      } else {
        setPhases(scorecardPhases.map(sp => ({ phase_name: sp.phase_name, phrases: [] })));
      }

      // Load files from storage
      const { data: fileList } = await supabase.storage
        .from("biblioteca")
        .list(me.organization_id, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      setFiles((fileList || []).map(f => ({ name: f.name, created_at: f.created_at || "" })));

      setLoading(false);
    }
    load();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true);
    setUploadMsg("");

    const path = `${orgId}/${file.name}`;
    const { error: upErr } = await supabase.storage.from("biblioteca").upload(path, file, { upsert: true });

    if (upErr) {
      setUploadMsg(`Error: ${upErr.message}`);
    } else {
      setUploadMsg(`"${file.name}" subido correctamente.`);
      setFiles(prev => [{ name: file.name, created_at: new Date().toISOString() }, ...prev]);
    }
    setUploading(false);
    e.target.value = "";
  };

  const startEdit = () => {
    setEditPhases(phases.map(p => ({ ...p, phrases: [...p.phrases] })));
    setEditing(true);
  };

  const updatePhrase = (phaseIdx: number, phraseIdx: number, value: string) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: p.phrases.map((ph, j) => j === phraseIdx ? value : ph) }
      : p
    ));
  };

  const addPhrase = (phaseIdx: number) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: [...p.phrases, ""] }
      : p
    ));
  };

  const removePhrase = (phaseIdx: number, phraseIdx: number) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: p.phrases.filter((_, j) => j !== phraseIdx) }
      : p
    ));
  };

  const publish = async () => {
    if (!scorecardId || !orgId) return;
    setSaving(true);

    const content: Record<string, string[]> = {};
    for (const p of editPhases) {
      content[p.phase_name] = p.phrases.filter(ph => ph.trim().length > 0);
    }

    // Unpublish existing
    await supabase.from("speech_versions")
      .update({ published: false })
      .eq("scorecard_id", scorecardId).eq("published", true);

    const newVersion = versionNum + 1;
    await supabase.from("speech_versions").insert({
      organization_id: orgId,
      scorecard_id: scorecardId,
      content,
      version_number: newVersion,
      published: true,
      created_by: (await supabase.auth.getSession()).data.session?.user.id,
    });

    setPhases(editPhases.map(p => ({ ...p, phrases: content[p.phase_name] || [] })));
    setVersionNum(newVersion);
    setUpdatedAt(new Date().toISOString());
    setEditing(false);
    setSaving(false);
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

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Biblioteca y Speech Ideal</h1>
          <p className="g1-subtitle">
            {versionNum > 0
              ? `Versión ${versionNum} — ${new Date(updatedAt!).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`
              : "Sin versión publicada aún"}
          </p>
        </div>

        {!editing ? (
          <>
            <div className="c5-phases">
              {phases.map((p, i) => (
                <div key={i} className="c5-phase-card">
                  <h3 className="c5-phase-name">{p.phase_name}</h3>
                  {p.phrases.length > 0 ? (
                    <ul className="c5-phrase-list">
                      {p.phrases.map((ph, j) => <li key={j} className="c5-phrase">{ph}</li>)}
                    </ul>
                  ) : (
                    <p className="c5-no-phrases">Sin frases publicadas para esta fase</p>
                  )}
                </div>
              ))}
            </div>
            <button className="btn-submit" style={{ marginTop: 24 }} onClick={startEdit}>
              Editar speech ideal
            </button>
          </>
        ) : (
          <>
            <div className="g5-edit-phases">
              {editPhases.map((p, pi) => (
                <div key={pi} className="g5-edit-card">
                  <h3 className="c5-phase-name">{p.phase_name}</h3>
                  {p.phrases.map((ph, phi) => (
                    <div key={phi} className="g5-phrase-row">
                      <input
                        className="input-field"
                        value={ph}
                        onChange={(e) => updatePhrase(pi, phi, e.target.value)}
                        placeholder="Frase clave..."
                      />
                      <button className="g5-remove-btn" onClick={() => removePhrase(pi, phi)}>x</button>
                    </div>
                  ))}
                  {p.phrases.length < 3 && (
                    <button className="g5-add-btn" onClick={() => addPhrase(pi)}>+ Agregar frase ({p.phrases.length}/3)</button>
                  )}
                  {p.phrases.length >= 3 && (
                    <span className="c2-hint">Máximo 3 frases por fase</span>
                  )}
                </div>
              ))}
            </div>
            <div className="g5-edit-actions">
              <button className="btn-submit" onClick={publish} disabled={saving}>
                {saving ? "Publicando..." : "Publicar nueva versión"}
              </button>
              <button className="g5-cancel-btn" onClick={() => setEditing(false)}>Cancelar</button>
            </div>
          </>
        )}

        {/* Biblioteca de archivos */}
        <div className="g1-section" style={{ marginTop: 24 }}>
          <h2 className="g1-section-title">Biblioteca de materiales</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label className="c2-file-btn" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
              {uploading ? "Subiendo..." : "Subir archivo"}
              <input type="file" accept=".pdf,.doc,.docx,.txt,.pptx" onChange={handleFileUpload} hidden disabled={uploading} />
            </label>
            <span className="c2-file-hint">Guiones, materiales de entrenamiento, documentos</span>
          </div>
          {uploadMsg && <p className={`c2-hint ${uploadMsg.startsWith("Error") ? "c2-char-warning" : ""}`} style={{ marginBottom: 8 }}>{uploadMsg}</p>}
          {files.length > 0 ? (
            <div className="g7-list">
              {files.map((f, i) => (
                <div key={i} className="g7-list-item">
                  <span className="g7-item-name">{f.name}</span>
                  <span className="g7-item-meta">{f.created_at ? new Date(f.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="g1-empty">Sin materiales subidos. Sube guiones o documentos de entrenamiento para el equipo.</p>
          )}
        </div>

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
