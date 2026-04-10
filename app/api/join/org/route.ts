import { NextResponse } from "next/server";
import { getServiceSupabase } from "../../../../lib/supabase-server";

// Public endpoint — no auth required. Returns the org name/slug for a
// given invite_token so the /join/[token] page can render before the
// user has logged in. Does NOT expose sensitive org data.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const admin = getServiceSupabase();
    const { data, error } = await admin
      .from("organizations")
      .select("id, name, slug, role_label_vendedor")
      .eq("invite_token", token)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Token inválido" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, org: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
