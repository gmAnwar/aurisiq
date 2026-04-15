"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getRoleLabel } from "../../lib/roleLabel";
import OfflineIndicator from "./OfflineIndicator";

interface NavItem {
  href: string;
  label: string;
}

import { hasAnyRole, type UserRole } from "../../lib/auth";
import { Sun, BarChart3, CalendarRange, MessageSquare, Users, FolderOpen, BookOpen, FileBarChart, Settings, ClipboardList, TrendingUp, UserCircle, LayoutDashboard, Building2, Bell, ShieldCheck, Mic, ListChecks, type LucideIcon } from "lucide-react";

interface RoleNavItem extends NavItem {
  requiredRoles: UserRole[];
  icon: LucideIcon;
}

// Unified nav items — sidebar renders items where user has any required role
const ALL_NAV_ITEMS: RoleNavItem[] = [
  { href: "/grabar", label: "Grabar", requiredRoles: ["captadora", "super_admin"], icon: Mic },
  { href: "/grabaciones-pendientes", label: "Pendientes", requiredRoles: ["captadora", "super_admin"], icon: ListChecks },
  { href: "/analisis", label: "Mi día", requiredRoles: ["captadora", "super_admin"], icon: Sun },
  { href: "/analisis/historial", label: "Mis análisis", requiredRoles: ["captadora", "super_admin"], icon: BarChart3 },
  { href: "/semana", label: "Mi semana", requiredRoles: ["captadora", "super_admin"], icon: CalendarRange },
  { href: "/speech", label: "Mi Speech", requiredRoles: ["captadora", "super_admin"], icon: MessageSquare },
  { href: "/equipo", label: "Equipo", requiredRoles: ["gerente", "direccion", "super_admin"], icon: Users },
  { href: "/equipo/expedientes", label: "Expedientes", requiredRoles: ["gerente", "super_admin"], icon: FolderOpen },
  { href: "/equipo/biblioteca", label: "Biblioteca", requiredRoles: ["gerente", "super_admin"], icon: BookOpen },
  { href: "/equipo/reportes", label: "Reportes", requiredRoles: ["gerente", "direccion", "super_admin"], icon: FileBarChart },
  { href: "/equipo/config", label: "Config", requiredRoles: ["gerente", "direccion", "super_admin"], icon: Settings },
  { href: "/direccion", label: "Resumen", requiredRoles: ["direccion", "super_admin"], icon: ClipboardList },
  { href: "/direccion/reportes", label: "Rep. Ejec.", requiredRoles: ["direccion", "super_admin"], icon: TrendingUp },
  { href: "/direccion/cuenta", label: "Cuenta", requiredRoles: ["direccion", "super_admin"], icon: UserCircle },
  { href: "/agencia", label: "Dashboard", requiredRoles: ["agencia", "super_admin"], icon: LayoutDashboard },
  { href: "/agencia/reportes", label: "Rep. Agencia", requiredRoles: ["agencia", "super_admin"], icon: Building2 },
  { href: "/agencia/alertas", label: "Alertas", requiredRoles: ["agencia", "super_admin"], icon: Bell },
  { href: "/admin", label: "Admin", requiredRoles: ["super_admin"], icon: ShieldCheck },
];

function getNavForRoles(roles: string[]): RoleNavItem[] {
  const session = { roles };
  const seen = new Set<string>();
  return ALL_NAV_ITEMS.filter(item => {
    if (seen.has(item.href)) return false;
    if (!hasAnyRole(session, item.requiredRoles)) return false;
    seen.add(item.href);
    return true;
  });
}

// Legacy compat — NAV_BY_ROLE still used by MOBILE_NAV
const NAV_BY_ROLE: Record<string, NavItem[]> = {
  captadora: getNavForRoles(["captadora"]),
  gerente: getNavForRoles(["gerente"]),
  direccion: getNavForRoles(["direccion"]),
  agencia: getNavForRoles(["agencia"]),
  super_admin: getNavForRoles(["super_admin"]),
};

// Sidebar for ALL roles (unified layout)
function useSidebarLayout(): boolean {
  return true;
}

// CTA "+ Nueva llamada" if user has captadora or super_admin
function showCta(roles: string[]): boolean {
  return hasAnyRole({ roles }, ["captadora", "super_admin"] as UserRole[]);
}

const MOBILE_NAV: Record<string, NavItem[]> = {
  captadora: NAV_BY_ROLE.captadora,
  gerente: [
    { href: "/equipo", label: "Equipo" },
    { href: "/equipo/reportes", label: "Reportes" },
    { href: "/equipo/biblioteca", label: "Biblioteca" },
    { href: "/equipo/config", label: "Config" },
  ],
  direccion: [
    { href: "/direccion", label: "Resumen" },
    { href: "/equipo", label: "Equipo" },
    { href: "/direccion/cuenta", label: "Cuenta" },
  ],
  agencia: NAV_BY_ROLE.agencia,
  super_admin: [
    { href: "/analisis", label: "Mi d\u00eda" },
    { href: "/equipo", label: "Equipo" },
    { href: "/direccion", label: "Resumen" },
    { href: "/agencia", label: "Calidad" },
    { href: "/admin", label: "Admin" },
  ],
};

interface NavBarProps {
  role: string;
  roles?: string[];
  userName: string;
  userEmail: string;
  orgSlug?: string | null;
  roleLabelVendedor?: string | null;
  trainingMode?: boolean;
  onTrainingRoleChange?: (role: string) => void;
  orgOptions?: { id: string; name: string }[];
  activeOrgId?: string | null;
  onActiveOrgChange?: (orgId: string) => void;
}

const TRAINING_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "captadora", label: "Captadora" },
  { value: "gerente", label: "Gerente" },
  { value: "direccion", label: "Dirección" },
];

export default function NavBar({ role, roles, userName, userEmail, orgSlug, roleLabelVendedor, trainingMode, onTrainingRoleChange, orgOptions, activeOrgId, onActiveOrgChange }: NavBarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // SSR-safe localStorage read for collapse preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("aurisiq:sidebar:collapsed");
      if (saved === "true") {
        setCollapsed(true);
        document.body.classList.add("sidebar-collapsed");
      }
    } catch { /* SSR or no localStorage */ }
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("aurisiq:sidebar:collapsed", String(next)); } catch {}
    if (next) document.body.classList.add("sidebar-collapsed");
    else document.body.classList.remove("sidebar-collapsed");
  };

  // Escape key + scroll lock for mobile menu
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
      window.addEventListener("keydown", onKey);
      return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
    } else {
      document.body.style.overflow = "";
    }
  }, [mobileOpen]);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const handleChangePassword = async () => {
    setPwdError("");
    setPwdSuccess(false);
    if (pwd.length < 8) { setPwdError("Mínimo 8 caracteres"); return; }
    if (pwd !== pwdConfirm) { setPwdError("Las contraseñas no coinciden"); return; }
    setPwdSubmitting(true);
    const { error: e } = await supabase.auth.updateUser({ password: pwd });
    if (e) {
      setPwdError(e.message);
      setPwdSubmitting(false);
      return;
    }
    setPwdSuccess(true);
    setPwd("");
    setPwdConfirm("");
    setPwdSubmitting(false);
    setTimeout(() => {
      setShowPwdForm(false);
      setPwdSuccess(false);
      setMenuOpen(false);
    }, 1500);
  };
  const effectiveRoles = roles && roles.length > 0 ? roles : [role];
  const allItems = getNavForRoles(effectiveRoles);
  const mobileItems = (MOBILE_NAV[role] || allItems).slice(0, 5);
  const isSidebar = useSidebarLayout();
  const isCta = showCta(effectiveRoles);
  const initial = userName.charAt(0).toUpperCase() || "?";
  const roleLabel = getRoleLabel(role, { slug: orgSlug, role_label_vendedor: roleLabelVendedor });

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <nav className={`navbar ${isSidebar ? "navbar-sidebar" : ""} ${isSidebar && collapsed ? "navbar-collapsed" : ""}`} role="navigation">
      <span className="navbar-brand">
        <svg className="navbar-sonar" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="12" r="3" fill="#00C2E0" />
          <path d="M10 6C7.2 7.6 5.5 9.6 5.5 12s1.7 4.4 4.5 6" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.8" />
          <path d="M7 4C3.4 6.2 1.5 8.8 1.5 12s1.9 5.8 5.5 8" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
          <path d="M13 8.5C12 9.3 11.2 10.5 11.2 12s.8 2.7 1.8 3.5" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.9" />
        </svg>
        {!collapsed && <><span style={{ color: "#00C2E0" }}>auris</span><span style={{ color: "#FFFFFF" }}>IQ</span></>}
      </span>
      {isSidebar && (
        <button className="navbar-collapse-btn" onClick={toggleCollapse} aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"} title={collapsed ? "Expandir" : "Colapsar"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
          </svg>
        </button>
      )}
      <div className="navbar-items">
      {/* CTA — Nueva llamada */}
      {isCta && (
        <Link href="/analisis/nueva" className="navbar-item navbar-item-cta" title={collapsed ? "Nueva llamada" : undefined}>
          <Mic size={18} className="navbar-item-icon" />
          <span className="navbar-item-label">Nueva llamada</span>
        </Link>
      )}
      {allItems.map((item) => {
        // Exact match for /analisis to avoid highlighting "Mi día" on /analisis/historial etc.
        const isActive = item.href === "/analisis"
          ? pathname === "/analisis"
          : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const isMobileVisible = mobileItems.some(m => m.href === item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`navbar-item ${isActive ? "navbar-active" : ""} ${!isMobileVisible ? "navbar-desktop-only" : ""}`}
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={18} className="navbar-item-icon" />
            <span className="navbar-item-label">{item.label}</span>
          </Link>
        );
      })}
      </div>

      {/* Hamburger button — mobile only */}
      <button
        className="navbar-hamburger"
        onClick={() => setMobileOpen(v => !v)}
        aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={mobileOpen}
        aria-controls="mobile-menu"
      >
        {mobileOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        )}
      </button>

      {/* Right section: CTA + user */}
      <div className="navbar-right">
        {/* CTA moved to sidebar items */}

        {/* Offline indicator — captadora only */}
        {isCta && <OfflineIndicator />}

        {/* Org selector — hidden on mobile, shown in hamburger menu instead */}
        {orgOptions && orgOptions.length > 1 && (
          <select
            className="navbar-org-select navbar-org-desktop"
            value={activeOrgId || ""}
            onChange={e => onActiveOrgChange?.(e.target.value)}
            title="Organización activa"
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              color: "#fff",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: 6,
              padding: "6px 10px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              marginRight: 8,
              maxWidth: 200,
            }}
          >
            {orgOptions.map(o => (
              <option key={o.id} value={o.id} style={{ color: "#000" }}>
                Org: {o.name}
              </option>
            ))}
          </select>
        )}

        {/* Training mode role selector */}
        {trainingMode && (
          <select
            className="navbar-training-select"
            value={TRAINING_ROLE_OPTIONS.some(o => o.value === role) ? role : "captadora"}
            onChange={e => onTrainingRoleChange?.(e.target.value)}
            title="Modo capacitación — cambiar rol de vista"
            style={{
              background: "rgba(0, 194, 224, 0.12)",
              color: "#00C2E0",
              border: "1px solid rgba(0, 194, 224, 0.4)",
              borderRadius: 6,
              padding: "6px 10px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              marginRight: 8,
            }}
          >
            {TRAINING_ROLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>🎓 {o.label}</option>
            ))}
          </select>
        )}

        {/* User panel */}
        <div className="navbar-user-panel">
          <button className="navbar-user-btn" onClick={() => setMenuOpen(!menuOpen)}>
            <span className="navbar-user-initial">{initial}</span>
            <span className="navbar-user-name">{userName}</span>
          </button>
          {menuOpen && (
            <>
              <div className="navbar-user-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="navbar-user-menu">
                <div className="navbar-menu-profile">
                  <span className="navbar-menu-name">{userName}</span>
                  <span className="navbar-menu-role">{roleLabel}</span>
                  <span className="navbar-menu-email-text">{userEmail}</span>
                </div>
                <div className="navbar-menu-sep" />
                <button
                  className="navbar-menu-logout"
                  style={{ color: "#00C2E0" }}
                  onClick={() => { setShowPwdForm(v => !v); setPwdError(""); setPwdSuccess(false); }}
                >
                  {showPwdForm ? "Cancelar" : "Cambiar contraseña"}
                </button>
                {showPwdForm && (
                  <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      className="input-field"
                      type="password"
                      placeholder="Nueva contraseña (min 8)"
                      value={pwd}
                      onChange={e => setPwd(e.target.value)}
                      autoComplete="new-password"
                    />
                    <input
                      className="input-field"
                      type="password"
                      placeholder="Confirmar contraseña"
                      value={pwdConfirm}
                      onChange={e => setPwdConfirm(e.target.value)}
                      autoComplete="new-password"
                    />
                    {pwdError && <p className="c2-rec-error" style={{ margin: 0 }}>{pwdError}</p>}
                    {pwdSuccess && <p style={{ margin: 0, color: "#16a34a", fontSize: 13 }}>✓ Contraseña actualizada</p>}
                    <button
                      className="btn-submit"
                      style={{ marginTop: 0, padding: "8px 12px" }}
                      onClick={handleChangePassword}
                      disabled={pwdSubmitting || !pwd || !pwdConfirm}
                    >
                      {pwdSubmitting ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                )}
                <div className="navbar-menu-sep" />
                <button className="navbar-menu-logout" onClick={handleSignOut}>Cerrar sesión</button>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Mobile menu panel */}
      {mobileOpen && (
        <div id="mobile-menu" className="navbar-mobile-panel">
          {/* Org selector — mobile only (hidden on desktop via CSS) */}
          {orgOptions && orgOptions.length > 1 && (
            <div className="navbar-org-mobile">
              <select
                className="navbar-org-select"
                value={activeOrgId || ""}
                onChange={e => { onActiveOrgChange?.(e.target.value); setMobileOpen(false); }}
                style={{
                  width: "100%",
                  background: "rgba(255, 255, 255, 0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: 6,
                  padding: "10px 12px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {orgOptions.map(o => (
                  <option key={o.id} value={o.id} style={{ color: "#000" }}>
                    Org: {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {allItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`navbar-mobile-link ${isActive ? "navbar-mobile-active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
