"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";

interface NavItem {
  href: string;
  label: string;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  captadora: [
    { href: "/analisis", label: "Mi d\u00eda" },
    { href: "/grabar", label: "\u25cf Grabar" },
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
    { href: "/grabar", label: "\u25cf Grabar" },
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

const SIDEBAR_ROLES = ["captadora", "gerente", "direccion", "agencia", "super_admin"];

const roleLabels: Record<string, string> = {
  captadora: "Captadora",
  gerente: "Gerente",
  direccion: "Dirección",
  agencia: "Agencia",
  super_admin: "Super Admin",
};

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
}

export default function NavBar({ role, userName, userEmail }: NavBarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const allItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.captadora;
  const mobileItems = MOBILE_NAV[role] || allItems.slice(0, 4);
  const useSidebar = SIDEBAR_ROLES.includes(role);
  const initial = userName.charAt(0).toUpperCase() || "?";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <nav className={`navbar ${useSidebar ? "navbar-sidebar" : ""}`}>
      <span className="navbar-brand">
        auris<span style={{ opacity: 0.45, fontStyle: "normal" }}>IQ</span>
      </span>
      {allItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const isMobileVisible = mobileItems.some(m => m.href === item.href);
        const isGrabar = item.href === "/grabar";
        return (
          <a
            key={item.href}
            href={item.href}
            className={`navbar-item ${isActive ? "navbar-active" : ""} ${!isMobileVisible ? "navbar-desktop-only" : ""} ${isGrabar ? "navbar-grabar" : ""}`}
          >
            {item.label}
          </a>
        );
      })}

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
                <span className="navbar-menu-role">{roleLabels[role] || role}</span>
                <span className="navbar-menu-email-text">{userEmail}</span>
              </div>
              <div className="navbar-menu-sep" />
              <button className="navbar-menu-logout" onClick={handleSignOut}>Cerrar sesión</button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
