import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

const VALID_ROLES = ["captadora", "gerente", "direccion", "agencia", "super_admin"];

export async function POST(req: Request) {
  const log = (...args: unknown[]) => console.log("[admin/create-user]", ...args);
  const errLog = (...args: unknown[]) => console.error("[admin/create-user]", ...args);

  // Quick env diagnostics
  const envDiag = {
    has_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    has_anon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    service_role_len: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").length,
  };
  log("env diag", envDiag);

  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) {
      errLog("auth failed", auth.status);
      return auth;
    }
    log("auth ok user_id=", auth.userId);

    let admin;
    try {
      admin = getServiceSupabase();
    } catch (e) {
      errLog("service role init failed", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "service role init failed", env: envDiag },
        { status: 500 }
      );
    }

    // Parse body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (e) {
      errLog("invalid json body", e);
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }
    log("body received", {
      name: body.name,
      email: body.email,
      role: body.role,
      organization_id: body.organization_id,
      training_mode: body.training_mode,
    });

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role as string | undefined;
    const trainingMode = !!body.training_mode;

    // Accept either organization_id (legacy, single) or organization_ids (new, array).
    const rawIds = Array.isArray(body.organization_ids) ? body.organization_ids : null;
    const orgIds: string[] = rawIds && rawIds.length > 0
      ? rawIds.filter((v: unknown) => typeof v === "string")
      : body.organization_id ? [String(body.organization_id)] : [];
    const organizationId = orgIds[0]; // primary

    if (!name || !email || !role || !organizationId) {
      errLog("missing fields", { name, email, role, orgIds });
      return NextResponse.json(
        { error: "name, email, role y al menos una organización son requeridos", received: { name, email, role, orgIds } },
        { status: 400 }
      );
    }
    if (!VALID_ROLES.includes(role)) {
      errLog("invalid role", role);
      return NextResponse.json({ error: `Rol inválido: ${role}` }, { status: 400 });
    }

    // Verify org exists
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .single();
    if (orgErr || !org) {
      errLog("org lookup failed", orgErr, "org_id=", organizationId);
      return NextResponse.json(
        { error: "Organización no encontrada", detail: orgErr?.message || null },
        { status: 400 }
      );
    }
    log("org verified", organizationId);

    // Create the auth user via invite (sends welcome email automatically)
    log("calling inviteUserByEmail", email);
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name, role, organization_id: organizationId },
    });

    if (inviteErr || !invited?.user) {
      errLog("inviteUserByEmail failed", {
        message: inviteErr?.message,
        status: (inviteErr as unknown as { status?: number })?.status,
        code: (inviteErr as unknown as { code?: string })?.code,
        name: inviteErr?.name,
      });
      return NextResponse.json(
        {
          error: "inviteUserByEmail falló: " + (inviteErr?.message || "sin mensaje"),
          detail: {
            message: inviteErr?.message || null,
            status: (inviteErr as unknown as { status?: number })?.status ?? null,
            code: (inviteErr as unknown as { code?: string })?.code ?? null,
            name: inviteErr?.name || null,
          },
          env: envDiag,
        },
        { status: 500 }
      );
    }

    const newUserId = invited.user.id;
    log("invite ok user_id=", newUserId);

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
      errLog("insert profile failed — rolling back auth user", insertErr);
      await admin.auth.admin.deleteUser(newUserId).catch(err => errLog("rollback failed", err));
      return NextResponse.json(
        { error: "Error insertando perfil: " + insertErr.message, detail: insertErr },
        { status: 500 }
      );
    }
    log("profile inserted", newUserId);

    // Insert user_organizations rows for every selected org (the primary
    // org is also mirrored here so the multi-org policies pick it up).
    try {
      const membershipRows = orgIds.map(oid => ({
        user_id: newUserId,
        organization_id: oid,
        role,
      }));
      const { error: memErr } = await admin
        .from("user_organizations")
        .upsert(membershipRows, { onConflict: "user_id,organization_id" });
      if (memErr) errLog("user_organizations upsert failed", memErr);
    } catch (e) {
      errLog("user_organizations upsert exception", e);
    }

    // Generate a magic/invite link we can show to the admin as backup
    let actionLink: string | null = null;
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
      });
      if (linkErr) errLog("generateLink warning", linkErr);
      actionLink = linkData?.properties?.action_link || null;
    } catch (e) {
      errLog("generateLink exception", e);
    }

    return NextResponse.json({
      ok: true,
      user_id: newUserId,
      email_sent: true,
      action_link: actionLink,
    });
  } catch (e) {
    errLog("unhandled exception", e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: msg, stack: e instanceof Error ? e.stack : null, env: envDiag },
      { status: 500 }
    );
  }
}
