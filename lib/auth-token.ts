// Auth token helpers — centralized to avoid inline supabase.auth.getSession()
// duplication across pages. Use these for any fetch() call that needs Bearer auth.

import { supabase } from "./supabase";

export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
