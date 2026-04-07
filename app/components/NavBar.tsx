"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getRoleLabel } from "../../lib/roleLabel";

interface NavItem {
  href: string;
  label: string;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  captadora: [
    { href: "/analisis", label: "Mi d\u00eda" },
    { href: "/analisis/historial", label: "Mis an\u00e1lisis" },
    { href: "/semana", label: "Mi semana" },
    { href: "/speech", label: "Mi Speech" },
  ],
  gerente: [
    { href: "/equipo", label: "Equipo" },
    { href: "/equipo/expedientes", label: "Expedientes" },
    { href: "/equipo/biblioteca", label: "Biblioteca" },
    { href: "/equipo/reportes", label: "Reportes" },
    { href: "/equipo/config", label: "Config" },
  ],
  direccion: [
    { href: "/equipo", label: "Equipo" },
    { href: "/equipo/reportes", label: "Reportes" },
    { href: "/equipo/config", label: "Config" },
    { href: "/direccion", label: "Resumen" },
    { href: "/direccion/reportes", label: "Rep. Ejec." },
    { href: "/direccion/cuenta", label: "Cuenta" },
  ],
  agencia: [
    { href: "/agencia", label: "Dashboard" },
    { href: "/agencia/reportes", label: "Reportes" },
    { href: "/agencia/alertas", label: "Alertas" },
  ],
  super_admin: [
    { href: "/analisis", label: "Mi d\u00eda" },
    { href: "/analisis/historial", label: "Mis an\u00e1lisis" },
    { href: "/semana", label: "Mi semana" },
    { href: "/speech", label: "Mi Speech" },
    { href: "/equipo", label: "Equipo" },
    { href: "/equipo/reportes", label: "Reportes" },
    { href: "/equipo/config", label: "Config" },
    { href: "/direccion", label: "Resumen" },
    { href: "/direccion/cuenta", label: "Cuenta" },
    { href: "/agencia", label: "Calidad" },
  ],
};

// Roles that use sidebar layout (gerente, direccion, agencia)
// captadora and super_admin use horizontal top bar
const SIDEBAR_ROLES = ["gerente", "direccion", "agencia"];

// Roles that show the "+ Nueva llamada" CTA button
const CTA_ROLES = ["captadora", "super_admin"];

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
  ],
};

interface NavBarProps {
  role: string;
  userName: string;
  userEmail: string;
  orgSlug?: string | null;
  roleLabelVendedor?: string | null;
}

export default function NavBar({ role, userName, userEmail, orgSlug, roleLabelVendedor }: NavBarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const allItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.captadora;
  const mobileItems = MOBILE_NAV[role] || allItems.slice(0, 4);
  const useSidebar = SIDEBAR_ROLES.includes(role);
  const showCta = CTA_ROLES.includes(role);
  const initial = userName.charAt(0).toUpperCase() || "?";
  const roleLabel = getRoleLabel(role, { slug: orgSlug, role_label_vendedor: roleLabelVendedor });

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <nav className={`navbar ${useSidebar ? "navbar-sidebar" : ""}`}>
      <span className="navbar-brand">
        <svg className="navbar-sonar" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="12" r="3" fill="#00C2E0" />
          <path d="M10 6C7.2 7.6 5.5 9.6 5.5 12s1.7 4.4 4.5 6" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.8" />
          <path d="M7 4C3.4 6.2 1.5 8.8 1.5 12s1.9 5.8 5.5 8" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
          <path d="M13 8.5C12 9.3 11.2 10.5 11.2 12s.8 2.7 1.8 3.5" stroke="#00C2E0" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.9" />
        </svg>
        <span style={{ color: "#00C2E0" }}>auris</span><span style={{ color: "#FFFFFF" }}>IQ</span>
      </span>
      {allItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const isMobileVisible = mobileItems.some(m => m.href === item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`navbar-item ${isActive ? "navbar-active" : ""} ${!isMobileVisible ? "navbar-desktop-only" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}

      {/* Right section: CTA + user */}
      <div className="navbar-right">
        {/* CTA button */}
        {showCta && (
          <Link href="/analisis/nueva" className="navbar-cta">
            + Nueva llamada
          </Link>
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
                <button className="navbar-menu-logout" onClick={handleSignOut}>Cerrar sesión</button>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
