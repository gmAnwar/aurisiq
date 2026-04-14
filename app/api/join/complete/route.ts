import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceSupabase, getServerSupabase } from "../../../../lib/supabase-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function resolveUserId(req: Request): Promise<{ id: string; email: string } | null> {
  try {
    const srv = await getServerSupabase();
    const { data: { user } } = await srv.auth.getUser();
    if (user) return { id: user.id, email: user.email || "" };
  } catch { /* ignore */ }
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await anon.auth.getUser(token);
  return data?.user ? { id: data.user.id, email: data.user.email || "" } : null;
}

export async function POST(req: Request) {
  try {
    const user = await resolveUserId(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let body: { token?: string; name?: string; role?: string; city?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const token = (body.token || "").trim();
    const name = (body.name || "").trim();
    const role = (body.role || "").trim();
    const city = (body.city || "").trim();

    if (!token || !name || !role) {
      return NextResponse.json({ error: "token, name, role son requeridos" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Validate invite token → get org
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .eq("invite_token", token)
      .maybeSingle();

    if (orgErr || !org) {
      return NextResponse.json({ error: "Token de invitación inválido" }, { status: 400 });
    }

    // Upsert user profile with service role (bypasses RLS)
    const row: Record<string, unknown> = {
      id: user.id,
      organization_id: org.id,
      email: user.email,
      name,
      role,
      roles: [role],
      active: true,
    };
    if (city) row.city = city;

    let { error } = await admin.from("users").upsert(row, { onConflict: "id" });

    // If city column doesn't exist yet (migration 016), retry without it
    if (error && error.message?.includes("city")) {
      delete row.city;
      const retry = await admin.from("users").upsert(row, { onConflict: "id" });
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
