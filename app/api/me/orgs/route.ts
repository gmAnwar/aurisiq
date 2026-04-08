import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceSupabase, getServerSupabase } from "../../../../lib/supabase-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function resolveUserId(req: Request): Promise<string | null> {
  try {
    const srv = await getServerSupabase();
    const { data: { user } } = await srv.auth.getUser();
    if (user) return user.id;
  } catch { /* ignore */ }
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await anon.auth.getUser(token);
  return data?.user?.id || null;
}

export async function GET(req: Request) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = getServiceSupabase();

    // Primary org from public.users
    const { data: profile } = await admin
      .from("users")
      .select("organization_id, role")
      .eq("id", userId)
      .single();

    // Membership rows (includes the primary via the migration backfill)
    const { data: memberships } = await admin
      .from("user_organizations")
      .select("organization_id, role")
      .eq("user_id", userId);

    const orgIds = new Set<string>();
    if (profile?.organization_id) orgIds.add(profile.organization_id);
    for (const m of memberships || []) orgIds.add(m.organization_id);

    if (orgIds.size === 0) {
      return NextResponse.json({ ok: true, orgs: [], primary_org_id: null });
    }

    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name, slug")
      .in("id", Array.from(orgIds));

    return NextResponse.json({
      ok: true,
      orgs: orgs || [],
      primary_org_id: profile?.organization_id || null,
      memberships: memberships || [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
