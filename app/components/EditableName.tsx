"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface EditableNameProps {
  analysisId: string;
  currentName: string | null;
  onSave?: (newName: string) => void;
  variant?: "heading" | "inline" | "link";
}

export default function EditableName({ analysisId, currentName, onSave, variant = "heading" }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const displayName = currentName && currentName !== "No identificado" ? currentName : null;

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
      />
    );
  }

  if (variant === "link" && !displayName) {
    return (
      <button className="editable-name-add" onClick={() => { setValue(""); setEditing(true); }}>
        Agregar nombre
      </button>
    );
  }

  if (variant === "heading") {
    return (
      <span className="editable-name-wrap" onClick={() => { setValue(displayName || ""); setEditing(true); }}>
        {displayName || "Prospecto"}
        <span className="editable-name-pencil">&#9998;</span>
      </span>
    );
  }

  // inline variant (for list items)
  return (
    <span className="editable-name-wrap editable-name-inline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setValue(displayName || ""); setEditing(true); }}>
      {displayName || "Sin nombre"}
      <span className="editable-name-pencil">&#9998;</span>
    </span>
  );
}
