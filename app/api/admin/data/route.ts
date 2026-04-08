import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function GET(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const admin = getServiceSupabase();

    const [orgsRes, usersRes, analysesRes, speechRes, membershipsRes] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name, slug, plan, analyses_count, access_status, invite_token, role_label_vendedor")
        .order("created_at", { ascending: false }),
      admin
        .from("users")
        .select("id, name, email, role, organization_id, active, training_mode, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("analyses")
        .select("id, organization_id, user_id, score_general, clasificacion, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("speech_versions")
        .select("id, organization_id, version_number, published, created_at, content")
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("user_organizations")
        .select("id, user_id, organization_id, role, created_at")
        .order("created_at", { ascending: true }),
    ]);

    if (orgsRes.error) console.error("[admin/data] orgs query error:", orgsRes.error);
    if (usersRes.error) console.error("[admin/data] users query error:", usersRes.error);
    if (analysesRes.error) console.error("[admin/data] analyses query error:", analysesRes.error);
    if (speechRes.error) console.error("[admin/data] speech query error:", speechRes.error);
    if (membershipsRes.error) console.error("[admin/data] memberships query error:", membershipsRes.error);

    // Enrich memberships with user + org names (client-side join via the
    // already-fetched lists — avoids a PostgREST embed which may 400 if
    // the foreign-key relationship isn't discoverable).
    const usersById = new Map((usersRes.data || []).map((u: { id: string; name: string }) => [u.id, u.name]));
    const orgsById = new Map((orgsRes.data || []).map((o: { id: string; name: string }) => [o.id, o.name]));
    const memberships = (membershipsRes.data || []).map((m: { id: string; user_id: string; organization_id: string; role: string; created_at: string }) => ({
      ...m,
      user_name: usersById.get(m.user_id) || null,
      org_name: orgsById.get(m.organization_id) || null,
    }));

    return NextResponse.json({
      ok: true,
      orgs: orgsRes.data || [],
      users: usersRes.data || [],
      analyses: analysesRes.data || [],
      speech_versions: speechRes.data || [],
      memberships,
      errors: {
        orgs: orgsRes.error?.message || null,
        users: usersRes.error?.message || null,
        analyses: analysesRes.error?.message || null,
        speech_versions: speechRes.error?.message || null,
        memberships: membershipsRes.error?.message || null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
