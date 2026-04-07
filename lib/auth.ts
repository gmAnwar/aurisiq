import { supabase } from "./supabase";

export interface UserSession {
  userId: string;
  role: string;
  organizationId: string;
  organizationSlug: string | null;
  organizationName: string | null;
  roleLabelVendedor: string | null;
  name: string;
}

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const MOCK_SESSION: UserSession = {
  userId: "mock-user-001",
  role: "super_admin",
  organizationId: "mock-org-001",
  organizationSlug: "immobili",
  organizationName: "Inmobili Internacional",
  roleLabelVendedor: "Captadora",
  name: "Elizabeth R.",
};

const ROLE_HOME: Record<string, string> = {
  captadora: "/analisis",
  gerente: "/equipo",
  direccion: "/direccion",
  agencia: "/agencia",
  super_admin: "/analisis",
};

const ROUTE_ROLES: Record<string, string[]> = {
  "/analisis": ["captadora", "super_admin"],
  "/speech": ["captadora", "super_admin"],
  "/semana": ["captadora", "super_admin"],
  "/equipo": ["gerente", "direccion", "super_admin"],
  "/direccion": ["direccion", "super_admin"],
  "/agencia": ["agencia", "super_admin"],
  "/admin": ["super_admin"],
};

export function getHomeForRole(role: string): string {
  return ROLE_HOME[role] || "/analisis";
}

export function isRoleAllowed(pathname: string, role: string): boolean {
  // Find the matching route prefix
  for (const [routePrefix, allowedRoles] of Object.entries(ROUTE_ROLES)) {
    if (pathname === routePrefix || pathname.startsWith(routePrefix + "/")) {
      return allowedRoles.includes(role);
    }
  }
  // Routes not in the map (like /) are accessible to all
  return true;
}

export async function getSession(): Promise<UserSession | null> {
  if (SKIP_AUTH) return MOCK_SESSION;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: userData } = await supabase
    .from("users")
    .select("organization_id, role, name")
    .eq("id", session.user.id)
    .single();

  if (!userData) return null;

  // Fetch organization data. Try with role_label_vendedor first; if the
  // column doesn't exist yet (migration 014 not applied), fall back.
  let orgSlug: string | null = null;
  let orgName: string | null = null;
  let roleLabelVendedor: string | null = null;

  let orgRes = await supabase
    .from("organizations")
    .select("slug, name, role_label_vendedor")
    .eq("id", userData.organization_id)
    .maybeSingle();

  if (orgRes.error && orgRes.error.message?.includes("role_label_vendedor")) {
    // Column doesn't exist yet — retry without it
    orgRes = await supabase
      .from("organizations")
      .select("slug, name")
      .eq("id", userData.organization_id)
      .maybeSingle();
  }

  if (orgRes.data) {
    orgSlug = orgRes.data.slug || null;
    orgName = orgRes.data.name || null;
    roleLabelVendedor = (orgRes.data as { role_label_vendedor?: string | null }).role_label_vendedor || null;
  }

  return {
    userId: session.user.id,
    role: userData.role,
    organizationId: userData.organization_id,
    organizationSlug: orgSlug,
    organizationName: orgName,
    roleLabelVendedor,
    name: userData.name,
  };
}

/**
 * Check auth and role for a protected page.
 * Returns the session if authorized, or redirects and returns null.
 */
export async function requireAuth(allowedRoles: string[]): Promise<UserSession | null> {
  if (SKIP_AUTH) return MOCK_SESSION;

  const session = await getSession();

  if (!session) {
    window.location.href = "/";
    return null;
  }

  if (!allowedRoles.includes(session.role)) {
    window.location.href = getHomeForRole(session.role);
    return null;
  }

  return session;
}
