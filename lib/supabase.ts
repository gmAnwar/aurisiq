import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ekvvsosbwkfyhawywgpn.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Browser client — persists session in cookies so server route handlers
// can read it via createServerClient + next/headers cookies().
export const supabase = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey || "placeholder-for-build"
);
