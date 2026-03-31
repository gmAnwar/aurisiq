"use client";

import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  captadora: [
    { href: "/analisis", label: "Mi d\u00eda" },
    { href: "/analisis/nueva", label: "Grabar" },
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
    { href: "/direccion/roi", label: "ROI" },
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
    { href: "/analisis/nueva", label: "Grabar" },
    { href: "/semana", label: "Mi semana" },
    { href: "/speech", label: "Mi Speech" },
    { href: "/equipo", label: "Equipo" },
    { href: "/equipo/reportes", label: "Reportes" },
    { href: "/equipo/config", label: "Config" },
    { href: "/direccion", label: "Resumen" },
    { href: "/direccion/roi", label: "ROI" },
    { href: "/direccion/cuenta", label: "Cuenta" },
    { href: "/agencia", label: "Calidad" },
  ],
};

// Roles that use sidebar on desktop
const SIDEBAR_ROLES = ["gerente", "direccion", "super_admin"];

// Mobile: max 4 items per role
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
    { href: "/direccion/roi", label: "ROI" },
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

export default function NavBar({ role }: { role: string }) {
  const pathname = usePathname();
  const allItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.captadora;
  const mobileItems = MOBILE_NAV[role] || allItems.slice(0, 4);
  const useSidebar = SIDEBAR_ROLES.includes(role);

  return (
    <nav className={`navbar ${useSidebar ? "navbar-sidebar" : ""}`}>
      <span className="navbar-brand">
        auris<span style={{ opacity: 0.45, fontStyle: "normal" }}>IQ</span>
      </span>
      {/* Desktop: all items. Mobile: max 4 */}
      {allItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const isMobileVisible = mobileItems.some(m => m.href === item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            className={`navbar-item ${isActive ? "navbar-active" : ""} ${!isMobileVisible ? "navbar-desktop-only" : ""}`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
