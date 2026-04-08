import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const VALID_ROLES = ["captadora", "gerente", "direccion", "agencia"];

export async function POST(req: Request) {
  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY no está configurado en el entorno del servidor" },
        { status: 500 }
      );
    }

    // Verify caller is an authenticated super_admin
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerRow, error: callerErr } = await admin
      .from("users")
      .select("role")
      .eq("id", userRes.user.id)
      .single();
    if (callerErr || callerRow?.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
    }

    // Parse body
    const body = await req.json();
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const role = body.role;
    const organizationId = body.organization_id;
    const trainingMode = !!body.training_mode;

    if (!name || !email || !role || !organizationId) {
      return NextResponse.json(
        { error: "name, email, role y organization_id son requeridos" },
        { status: 400 }
      );
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }

    // Verify org exists
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .single();
    if (orgErr || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 400 });
    }

    // Create the auth user via invite (sends welcome email automatically)
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name, role, organization_id: organizationId },
    });

    if (inviteErr || !invited?.user) {
      return NextResponse.json(
        { error: "Error creando usuario en auth: " + (inviteErr?.message || "unknown") },
        { status: 500 }
      );
    }

    const newUserId = invited.user.id;

    // Insert profile row in public.users
    const { error: insertErr } = await admin.from("users").insert({
      id: newUserId,
      organization_id: organizationId,
      email,
      name,
      role,
      training_mode: trainingMode,
      active: true,
    });

    if (insertErr) {
      // Try to roll back the auth user to avoid orphans
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return NextResponse.json(
        { error: "Error insertando perfil: " + insertErr.message },
        { status: 500 }
      );
    }

    // Generate a magic/invite link we can show to the admin as backup
    let actionLink: string | null = null;
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
      });
      actionLink = linkData?.properties?.action_link || null;
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      user_id: newUserId,
      email_sent: true,
      action_link: actionLink,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
