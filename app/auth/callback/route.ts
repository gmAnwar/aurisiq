import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ekvvsosbwkfyhawywgpn.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

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
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    if (data?.session?.user?.id) {
      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", data.session.user.id)
        .single();

      const home = ROLE_HOME[userData?.role || ""] || "/analisis";
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
