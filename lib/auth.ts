import { supabase } from "./supabase";

export type UserRole = 'captadora' | 'gerente' | 'direccion' | 'agencia' | 'super_admin';

export interface UserSession {
  userId: string;
  role: string;              // effective role (may be overridden by training mode)
  roles: string[];           // effective roles array (defensive — populated from roles[] or [role])
  realRole: string;          // actual DB role
  realRoles: string[];       // actual DB roles array
  trainingMode: boolean;
  organizationId: string;
  organizationSlug: string | null;
  organizationName: string | null;
  roleLabelVendedor: string | null;
  name: string;
}

export function hasRole(session: { roles?: string[]; role?: string } | null, role: UserRole): boolean {
  if (!session) return false;
  const roles = session.roles ?? (session.role ? [session.role] : []);
  return roles.includes(role);
}

export function hasAnyRole(session: { roles?: string[]; role?: string } | null, allowed: UserRole[]): boolean {
  if (!session) return false;
  const roles = session.roles ?? (session.role ? [session.role] : []);
  return roles.some(r => allowed.includes(r as UserRole));
}

export function getRolesForSession(session: { roles?: string[]; role?: string } | null): string[] {
  if (!session) return [];
  return session.roles ?? (session.role ? [session.role] : []);
}

const TRAINING_ALLOWED_ROLES = ["captadora", "gerente", "direccion"];

export function getTrainingRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const r = window.localStorage.getItem("training_role");
    return r && TRAINING_ALLOWED_ROLES.includes(r) ? r : null;
  } catch { return null; }
}

export function setTrainingRole(role: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (role && TRAINING_ALLOWED_ROLES.includes(role)) {
      window.localStorage.setItem("training_role", role);
    } else {
      window.localStorage.removeItem("training_role");
    }
  } catch { /* ignore */ }
}

/** super_admin active org override — read by getSession() so all pages
 *  see the selected org as if it were the user's own organization. */
export function getActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem("admin_active_org_id"); } catch { return null; }
}

export function setActiveOrgId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem("admin_active_org_id", id);
    else window.localStorage.removeItem("admin_active_org_id");
  } catch { /* ignore */ }
}

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const MOCK_SESSION: UserSession = {
  userId: "mock-user-001",
  role: "super_admin",
  roles: ["super_admin"],
  realRole: "super_admin",
  realRoles: ["super_admin"],
  trainingMode: false,
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

  // Try with roles + training_mode; fall back defensively
  let userRes = await supabase
    .from("users")
    .select("organization_id, role, roles, name, training_mode")
    .eq("id", session.user.id)
    .single();

  if (userRes.error && userRes.error.message?.includes("training_mode")) {
    userRes = await supabase
      .from("users")
      .select("organization_id, role, roles, name")
      .eq("id", session.user.id)
      .single();
  }

  const userData = userRes.data as
    | { organization_id: string; role: string; roles?: string[] | null; name: string; training_mode?: boolean | null }
    | null;
  if (!userData) return null;

  const realRole = userData.role;
  const realRoles = Array.isArray(userData.roles) && userData.roles.length > 0
    ? userData.roles
    : [realRole];
  const trainingMode = !!userData.training_mode;
  const trainingRole = trainingMode ? getTrainingRole() : null;
  const effectiveRole = trainingRole || realRole;
  const effectiveRoles = trainingRole ? [trainingRole] : realRoles;

  // Any multi-org user (or super_admin) can switch active org via the
  // navbar selector. The active org is stored in localStorage and read
  // here so every page that uses session.organizationId sees it.
  let effectiveOrgId = userData.organization_id;
  const activeOrg = getActiveOrgId();
  if (activeOrg) effectiveOrgId = activeOrg;

  // Fetch organization data. Try with role_label_vendedor first; if the
  // column doesn't exist yet (migration 014 not applied), fall back.
  let orgSlug: string | null = null;
  let orgName: string | null = null;
  let roleLabelVendedor: string | null = null;

  let orgRes = await supabase
    .from("organizations")
    .select("slug, name, role_label_vendedor")
    .eq("id", effectiveOrgId)
    .maybeSingle();

  if (orgRes.error && orgRes.error.message?.includes("role_label_vendedor")) {
    // Column doesn't exist yet — retry without it
    orgRes = await supabase
      .from("organizations")
      .select("slug, name")
      .eq("id", effectiveOrgId)
      .maybeSingle();
  }

  if (orgRes.data) {
    orgSlug = orgRes.data.slug || null;
    orgName = orgRes.data.name || null;
    roleLabelVendedor = (orgRes.data as { role_label_vendedor?: string | null }).role_label_vendedor || null;
  }

  return {
    userId: session.user.id,
    role: effectiveRole,
    roles: effectiveRoles,
    realRole,
    realRoles,
    trainingMode,
    organizationId: effectiveOrgId,
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

  if (!hasAnyRole(session, allowedRoles as UserRole[])) {
    window.location.href = getHomeForRole(session.role);
    return null;
  }

  return session;
}
