"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface EditableNameProps {
  analysisId: string;
  currentName: string | null;
  onSave?: (newName: string) => void;
}

export default function EditableName({ analysisId, currentName, onSave }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const displayName = currentName && currentName !== "No identificado" ? currentName : "Sin nombre";

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentName) { setEditing(false); return; }
    setSaving(true);
    await supabase.from("analyses").update({ prospect_name: trimmed }).eq("id", analysisId);
    setSaving(false);
    setEditing(false);
    onSave?.(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="editable-name-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        disabled={saving}
        placeholder="Nombre del prospecto"
        onClick={e => e.preventDefault()}
      />
    );
  }

  return (
    <span className="editable-name-wrap" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setValue(currentName || ""); setEditing(true); }}>
      {displayName}
      <svg className="editable-name-pencil" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.5 1.5a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12L5.5 13.5 1 15l1.5-4.5L11.5 1.5z"/>
      </svg>
    </span>
  );
}
