import { NextResponse } from "next/server";
import { getServerSupabase } from "../../../lib/supabase-server";

const ROLE_HOME: Record<string, string> = {
  captadora: "/analisis",
  gerente: "/equipo",
  direccion: "/direccion",
  agencia: "/agencia",
  super_admin: "/analisis",
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    // Invite flow: redirect to set-password page; the client will exchange
    // the code there so the session is persisted in browser storage before
    // the user sets a permanent password.
    if (type === "invite") {
      return NextResponse.redirect(`${origin}/auth/set-password?code=${encodeURIComponent(code)}`);
    }

    const supabase = await getServerSupabase();
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    if (data?.session?.user?.id) {
      const { data: userData } = await supabase
        .from("users")
        .select("role, roles")
        .eq("id", data.session.user.id)
        .single();

      const userRoles: string[] = Array.isArray(userData?.roles) && userData.roles.length > 0
        ? userData.roles : userData?.role ? [userData.role] : [];
      // Priority: super_admin > direccion > agencia > gerente > captadora
      const PRIORITY = ["super_admin", "direccion", "agencia", "gerente", "captadora"];
      const topRole = PRIORITY.find(r => userRoles.includes(r)) || "";
      const home = ROLE_HOME[topRole] || "/analisis";
      return NextResponse.redirect(`${origin}${home}`);
    }

    return NextResponse.redirect(`${origin}/analisis`);
  }

  if (token_hash && type) {
    // OTP flow — redirect to root, client will handle role routing
    return NextResponse.redirect(`${origin}/#access_token=${token_hash}&type=${type}`);
  }

  return NextResponse.redirect(`${origin}/`);
}
