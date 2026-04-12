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

    // Only select per-org scorecard — never fall back to globals
    const { data, error } = await admin
      .from("scorecards")
      .select("id, organization_id, name, version, vertical")
      .eq("organization_id", orgId)
      .eq("active", true)
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
