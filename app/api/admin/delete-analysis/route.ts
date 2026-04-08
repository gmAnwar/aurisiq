import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    let body: { analysis_id?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }
    const analysisId = body?.analysis_id;
    if (!analysisId) {
      return NextResponse.json({ error: "analysis_id requerido" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Cascade manually: analysis_phases + analysis_jobs reference analyses
    // by id without ON DELETE CASCADE in the current schema.
    const phasesRes = await admin.from("analysis_phases").delete().eq("analysis_id", analysisId);
    if (phasesRes.error) console.error("[delete-analysis] phases", phasesRes.error);

    const jobsRes = await admin.from("analysis_jobs").delete().eq("analysis_id", analysisId);
    if (jobsRes.error) console.error("[delete-analysis] jobs", jobsRes.error);

    const { error } = await admin.from("analyses").delete().eq("id", analysisId);
    if (error) {
      console.error("[delete-analysis] analyses", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
