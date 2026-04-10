import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const analysisId = body?.analysis_id;
    if (!analysisId) {
      return NextResponse.json({ error: "analysis_id requerido" }, { status: 400 });
    }

    const admin = getServiceSupabase();
    const { error } = await admin.from("analyses").delete().eq("id", analysisId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
