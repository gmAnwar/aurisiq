"use client";

import { useState, useEffect, useRef } from "react";
import { PRESET_LABELS, formatDateShort, fromISODate, type PresetKey } from "../../lib/date-presets";

interface DateRangeFilterProps {
  range: PresetKey | "custom";
  from?: string;
  to?: string;
  onChange: (range: PresetKey | "custom", from?: string, to?: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tz?: string;
}

export default function DateRangeFilter({ range, from, to, onChange }: DateRangeFilterProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(from || "");
  const [customTo, setCustomTo] = useState(to || "");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCustomFrom(from || ""); }, [from]);
  useEffect(() => { setCustomTo(to || ""); }, [to]);

  useEffect(() => {
    if (!showCustom) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCustom]);

  const customLabel = range === "custom" && from && to
    ? `${formatDateShort(fromISODate(from))} – ${formatDateShort(fromISODate(to))}`
    : "Personalizado...";

  const applyDisabled = !customFrom || !customTo || customFrom > customTo;

  const applyCustom = () => {
    if (applyDisabled) return;
    onChange("custom", customFrom, customTo);
    setShowCustom(false);
  };

  return (
    <div className="historial-filters">
      <div ref={wrapperRef} style={{ position: "relative" }}>
        <select
          className="historial-select"
          value={range === "custom" ? "custom" : range}
          onChange={e => {
            const v = e.target.value;
            if (v === "custom") {
              setShowCustom(true);
            } else {
              setShowCustom(false);
              onChange(v as PresetKey);
            }
          }}
        >
          {(Object.keys(PRESET_LABELS) as PresetKey[]).map(k => (
            <option key={k} value={k}>{PRESET_LABELS[k]}</option>
          ))}
          <option value="custom">{customLabel}</option>
        </select>
        {showCustom && (
          <div className="historial-custom-picker">
            <label style={{ fontSize: 12, color: "var(--ink-light)" }}>Desde</label>
            <input
              type="date"
              className="historial-date-input"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
            <label style={{ fontSize: 12, color: "var(--ink-light)" }}>Hasta</label>
            <input
              type="date"
              className="historial-date-input"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                className="historial-apply-btn"
                onClick={applyCustom}
                disabled={applyDisabled}
              >
                Aplicar
              </button>
              <button
                className="historial-cancel-btn"
                onClick={() => setShowCustom(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
