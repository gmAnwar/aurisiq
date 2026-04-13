"use client";

import { useState, useEffect } from "react";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
}

export default function MobileSelect({ value, onChange, options, placeholder, label, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const selectedLabel = options.find(o => o.value === value)?.label || placeholder || "";

  // Desktop: native select
  if (!isMobile) {
    return (
      <select
        className="input-field c2-select"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.filter(o => o.value !== "").map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    );
  }

  // Mobile: bottom sheet
  return (
    <>
      <button
        type="button"
        className="input-field c2-select"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={{ textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ color: value ? "var(--ink)" : "var(--text-faint, #a3a3a3)" }}>{value ? selectedLabel : placeholder}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, animation: "msel-fade-in 0.15s ease" }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
            background: "#fff", borderRadius: "16px 16px 0 0",
            padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
            maxHeight: "60vh", overflowY: "auto",
            animation: "msel-slide-up 0.2s ease-out",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{label || placeholder || "Seleccionar"}</span>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--ink-light)", padding: "4px" }}>&times;</button>
            </div>
            {placeholder && (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", textAlign: "left", padding: "12px 8px",
                  background: value === "" ? "var(--accent-soft, #e0f7fa)" : "none",
                  border: "none", borderBottom: "1px solid var(--border, #f0f0f0)",
                  fontSize: 14, cursor: "pointer", color: "var(--ink)",
                }}
              >
                {placeholder}
                {value === "" && <span style={{ color: "var(--accent, #00C2E0)" }}>✓</span>}
              </button>
            )}
            {options.filter(o => o.value !== "").map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { if (!o.disabled) { onChange(o.value); setOpen(false); } }}
                disabled={o.disabled}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", textAlign: "left", padding: "12px 8px",
                  background: value === o.value ? "var(--accent-soft, #e0f7fa)" : "none",
                  border: "none", borderBottom: "1px solid var(--border, #f0f0f0)",
                  fontSize: 14, cursor: o.disabled ? "default" : "pointer",
                  color: o.disabled ? "var(--ink-light)" : "var(--ink)",
                  opacity: o.disabled ? 0.5 : 1,
                }}
              >
                {o.label}
                {value === o.value && <span style={{ color: "var(--accent, #00C2E0)" }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
