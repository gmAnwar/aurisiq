import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

const VALID_ROLES = ["captadora", "gerente", "direccion", "agencia", "super_admin"];

// GET /api/admin/user-orgs?user_id=...
export async function GET(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id");
    if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

    const admin = getServiceSupabase();
    const { data, error } = await admin
      .from("user_organizations")
      .select("id, organization_id, role, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, memberships: data || [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/admin/user-orgs  { user_id, organization_id, role }
export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const userId = body.user_id;
    const organizationId = body.organization_id;
    const role = body.role;

    if (!userId || !organizationId || !role) {
      return NextResponse.json({ error: "user_id, organization_id, role requeridos" }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Rol inválido: ${role}` }, { status: 400 });
    }

    const admin = getServiceSupabase();
    const { data, error } = await admin
      .from("user_organizations")
      .upsert(
        { user_id: userId, organization_id: organizationId, role },
        { onConflict: "user_id,organization_id" }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, membership: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/admin/user-orgs?id=...
export async function DELETE(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const admin = getServiceSupabase();
    const { error } = await admin.from("user_organizations").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
