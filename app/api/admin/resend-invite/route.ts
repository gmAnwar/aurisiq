import { NextResponse } from "next/server";
import { getServiceSupabase, requireSuperAdmin } from "../../../../lib/supabase-server";

// The action_link returned by this endpoint is a one-time Supabase invite URL.
// It expires in 24h and grants account access — only expose to super_admin.
// To resend, we generate a fresh link each time via admin.auth.admin.generateLink.
export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth instanceof Response) return auth;

    let body: { email?: string; user_id?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const email = (body.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email requerido" }, { status: 400 });
    }

    const admin = getServiceSupabase();

    // Try to generate a fresh invite action_link first — this works even
    // for users that already exist in auth.users (unlike inviteUserByEmail
    // which can fail with "User already registered").
    let actionLink: string | null = null;
    let emailSent = false;

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
    });

    if (!linkErr && linkData?.properties?.action_link) {
      actionLink = linkData.properties.action_link;
    } else {
      console.error("[resend-invite] generateLink failed, falling back to inviteUserByEmail", linkErr);
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteErr) {
        return NextResponse.json(
          { error: "No se pudo regenerar la invitación: " + inviteErr.message, detail: inviteErr },
          { status: 500 }
        );
      }
      emailSent = true;
      // Try to also surface a link after the invite
      const retryLink = await admin.auth.admin.generateLink({ type: "invite", email });
      if (retryLink.data?.properties?.action_link) {
        actionLink = retryLink.data.properties.action_link;
      }
      void invited;
    }

    return NextResponse.json({
      ok: true,
      email,
      email_sent: emailSent,
      action_link: actionLink,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
