import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function GET(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) {
      return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Prefer the org-scoped active scorecard; fall back to a global
    // (organization_id IS NULL) scorecard. Matches the client query in C2.
    const { data, error } = await admin
      .from("scorecards")
      .select("id, organization_id, name, version, vertical")
      .or(`organization_id.eq.${orgId},organization_id.is.null`)
      .eq("active", true)
      .order("organization_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "No active scorecard for org" }, { status: 404 });

    return NextResponse.json({ ok: true, scorecard: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
