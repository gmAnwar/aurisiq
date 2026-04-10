import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const userId = body?.user_id;
    const updates = body?.updates;

    if (!userId || !updates || typeof updates !== "object") {
      return NextResponse.json({ error: "user_id y updates requeridos" }, { status: 400 });
    }

    // Whitelist allowed fields
    const allowed = ["role", "active", "training_mode", "name", "city"];
    const clean: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) clean[key] = updates[key];
    }

    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: "No hay campos válidos para actualizar" }, { status: 400 });
    }

    const admin = getServiceSupabase();
    const { error } = await admin.from("users").update(clean).eq("id", userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
