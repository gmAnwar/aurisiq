// Date range presets for filter dropdowns

export interface DateRange {
  from: Date;
  to: Date;
}

export type PresetKey =
  | "today" | "yesterday" | "last_7" | "last_14" | "last_30"
  | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_year" | "all";

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  last_7: "Últimos 7 días",
  last_14: "Últimos 14 días",
  last_30: "Últimos 30 días",
  this_week: "Esta semana",
  last_week: "Semana pasada",
  this_month: "Este mes",
  last_month: "Mes pasado",
  this_year: "Este año",
  all: "Todo",
};

export function getPresetRange(key: PresetKey): DateRange | null {
  if (key === "all") return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);

  switch (key) {
    case "today":
      return { from: today, to: tomorrow };
    case "yesterday": {
      const y = new Date(today.getTime() - 86400000);
      return { from: y, to: today };
    }
    case "last_7":
      return { from: new Date(today.getTime() - 7 * 86400000), to: tomorrow };
    case "last_14":
      return { from: new Date(today.getTime() - 14 * 86400000), to: tomorrow };
    case "last_30":
      return { from: new Date(today.getTime() - 30 * 86400000), to: tomorrow };
    case "this_week": {
      const day = today.getDay();
      const mon = new Date(today.getTime() - ((day === 0 ? 6 : day - 1) * 86400000));
      return { from: mon, to: tomorrow };
    }
    case "last_week": {
      const day = today.getDay();
      const thisMon = new Date(today.getTime() - ((day === 0 ? 6 : day - 1) * 86400000));
      const lastMon = new Date(thisMon.getTime() - 7 * 86400000);
      return { from: lastMon, to: thisMon };
    }
    case "this_month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
    case "last_month": {
      const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: firstLastMonth, to: firstThisMonth };
    }
    case "this_year":
      return { from: new Date(now.getFullYear(), 0, 1), to: tomorrow };
  }
}

export function formatDateShort(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
