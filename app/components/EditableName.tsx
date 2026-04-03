"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface EditableFieldProps {
  analysisId: string;
  field: string;
  currentValue: string | null;
  placeholder?: string;
  onSave?: (newValue: string) => void;
}

export default function EditableField({ analysisId, field, currentValue, placeholder = "Sin nombre", onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const isPlaceholder = !currentValue || currentValue === "No identificado" || currentValue === "No identificada" || currentValue === "No mencionado";
  const displayText = isPlaceholder ? placeholder : currentValue;

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentValue) { setEditing(false); return; }
    setSaving(true);
    await supabase.from("analyses").update({ [field]: trimmed }).eq("id", analysisId);
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
        placeholder={placeholder}
        onClick={e => { e.preventDefault(); e.stopPropagation(); }}
      />
    );
  }

  return (
    <span
      className={`editable-name-wrap ${isPlaceholder ? "editable-name-placeholder" : ""}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setValue(currentValue || ""); setEditing(true); }}
    >
      {displayText}
      <svg className="editable-name-pencil" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.5 1.5a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12L5.5 13.5 1 15l1.5-4.5L11.5 1.5z"/>
      </svg>
    </span>
  );
}
