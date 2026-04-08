import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function GET(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const admin = getServiceSupabase();

    const [orgsRes, usersRes, analysesRes, speechRes] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name, slug, plan, analyses_count, analyses_limit, access_status, invite_token, role_label_vendedor")
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
    ]);

    return NextResponse.json({
      ok: true,
      orgs: orgsRes.data || [],
      users: usersRes.data || [],
      analyses: analysesRes.data || [],
      speech_versions: speechRes.data || [],
      errors: {
        orgs: orgsRes.error?.message || null,
        users: usersRes.error?.message || null,
        analyses: analysesRes.error?.message || null,
        speech_versions: speechRes.error?.message || null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
