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
    const allowed = ["role", "roles", "active", "training_mode", "name", "city"];
    const clean: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) clean[key] = updates[key];
    }

    // Validate roles array if provided
    const VALID_ROLES = ["captadora", "gerente", "direccion", "agencia", "super_admin"];
    if (clean.roles) {
      if (!Array.isArray(clean.roles) || clean.roles.length === 0) {
        return NextResponse.json({ error: "roles debe ser un array no vacío" }, { status: 400 });
      }
      const invalid = (clean.roles as string[]).filter(r => !VALID_ROLES.includes(r));
      if (invalid.length > 0) {
        return NextResponse.json({ error: `Roles inválidos: ${invalid.join(", ")}` }, { status: 400 });
      }
      clean.roles = [...new Set(clean.roles as string[])]; // dedup
    }

    // Legacy compat: if only role sent (no roles), build roles=[role]
    if (clean.role && !clean.roles) {
      console.warn("[update-user] Deprecated: received role instead of roles. Use roles[] instead.");
      clean.roles = [clean.role as string];
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
