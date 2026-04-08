import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../../lib/supabase-server";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Missing analysis id" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Cascade rows that aren't covered by an ON DELETE CASCADE on the
    // analyses FK (analysis_phases + analysis_jobs point back by id).
    await admin.from("analysis_phases").delete().eq("analysis_id", id);
    await admin.from("analysis_jobs").delete().eq("analysis_id", id);

    const { error } = await admin.from("analyses").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Missing analysis id" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    const { data: analysis, error: aErr } = await admin
      .from("analyses")
      .select(
        "id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, prospect_name, prospect_zone, property_type, business_type, equipment_type, vehicle_interest, financing_type, sale_reason, prospect_phone, checklist_results, manager_note, related_analysis_id, created_at, scorecard_id, organization_id, funnel_stage_id, status"
      )
      .eq("id", id)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json({ error: aErr.message }, { status: 500 });
    }
    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [phasesRes, categoriesRes, vertRes, relatedRes] = await Promise.all([
      admin
        .from("analysis_phases")
        .select("phase_name, score, score_max")
        .eq("analysis_id", id)
        .order("created_at", { ascending: true }),
      admin
        .from("descalification_categories")
        .select("code, label")
        .eq("organization_id", analysis.organization_id),
      analysis.scorecard_id
        ? admin.from("scorecards").select("vertical").eq("id", analysis.scorecard_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      analysis.prospect_name && analysis.prospect_name !== "No identificado"
        ? admin
            .from("analyses")
            .select("id, score_general, created_at, funnel_stage_id")
            .eq("organization_id", analysis.organization_id)
            .eq("status", "completado")
            .neq("id", id)
            .ilike("prospect_name", analysis.prospect_name)
            .order("created_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
    ]);

    return NextResponse.json({
      ok: true,
      analysis,
      phases: phasesRes.data || [],
      descal_categories: categoriesRes.data || [],
      vertical: (vertRes.data as { vertical?: string } | null)?.vertical || null,
      related: relatedRes.data || [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
