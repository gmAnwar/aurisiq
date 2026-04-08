import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Server-side Supabase client bound to the incoming request cookies.
 * Use for reading the authenticated user's session in route handlers.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // In read-only contexts (e.g., RSC) writes are ignored.
        }
      },
    },
  });
}

/**
 * Service-role Supabase client — bypasses RLS. Only use in server routes
 * after verifying the caller is authorized.
 */
export function getServiceSupabase() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurado en el entorno del servidor");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve and verify the caller is an authenticated super_admin.
 * Returns the user id on success, or a Response to return directly.
 */
export async function requireSuperAdmin(req: Request): Promise<{ userId: string } | Response> {
  // 1. Try session cookies (preferred — set by createBrowserClient on login)
  let userId: string | null = null;
  try {
    const srv = await getServerSupabase();
    const { data: { user } } = await srv.auth.getUser();
    if (user) userId = user.id;
  } catch { /* ignore */ }

  // 2. Fallback: Bearer token in Authorization header
  if (!userId) {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: userRes } = await anonClient.auth.getUser(token);
      if (userRes?.user) userId = userRes.user.id;
    }
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let admin;
  try {
    admin = getServiceSupabase();
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "service role missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: row, error: rowErr } = await admin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  if (rowErr || row?.role !== "super_admin") {
    return new Response(JSON.stringify({ error: "Forbidden — super_admin only", detail: rowErr?.message || `role=${row?.role ?? "null"}` }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { userId };
}
