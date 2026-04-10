import { NextResponse } from "next/server";
import { getServiceSupabase } from "../../../../lib/supabase-server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const password = (body.password || "");
    const inviteToken = (body.invite_token || "").trim();

    if (!email || !password || !inviteToken) {
      return NextResponse.json({ error: "email, password e invite_token son requeridos" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Validate invite token
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id, name")
      .eq("invite_token", inviteToken)
      .maybeSingle();

    if (orgErr || !org) {
      return NextResponse.json({ error: "Token de invitación inválido" }, { status: 400 });
    }

    // Check if user already exists in auth
    const { data: existingList } = await admin.auth.admin.listUsers();
    const existing = (existingList?.users as { id: string; email?: string }[] | undefined)?.find(u => u.email === email);

    if (existing) {
      // User exists in auth — just return success so client can signIn
      return NextResponse.json({ ok: true, user_id: existing.id, org_name: org.name, already_exists: true });
    }

    // Create new auth user with confirmed email + password
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: "Error creando cuenta: " + (createErr?.message || "desconocido") },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, user_id: created.user.id, org_name: org.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
