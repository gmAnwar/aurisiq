import { supabase } from "./supabase";

const DEFAULT_TZ = "America/Monterrey";

let cachedTz: string | null = null;

/** Fetch org timezone once per session, cache it. Default: America/Monterrey */
export async function getOrgTimezone(orgId: string): Promise<string> {
  if (cachedTz) return cachedTz;
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .single();
  cachedTz = data?.timezone || DEFAULT_TZ;
  return cachedTz;
}

/** Get "now" in the org's timezone as a Date object */
function nowInTz(tz: string): Date {
  const str = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

/** Get today at 00:00 in the org's timezone, returned as ISO string for Supabase queries */
export function todayStart(tz: string): string {
  const d = nowInTz(tz);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Get start of current week (Sunday) at 00:00 in org timezone */
export function weekStart(tz: string): string {
  const d = nowInTz(tz);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Get start of previous week at 00:00 in org timezone */
export function prevWeekStart(tz: string): string {
  const d = nowInTz(tz);
  d.setDate(d.getDate() - d.getDay() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Get start of current month at 00:00 in org timezone */
export function monthStart(tz: string): string {
  const d = nowInTz(tz);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Get formatted today string for display (e.g. "lunes, 30 de marzo") */
export function todayDisplay(tz: string): string {
  const d = nowInTz(tz);
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}
