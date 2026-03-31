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
    { href: "/equipo", label: "Equipo" },
    { href: "/direccion", label: "Direcci\u00f3n" },
  ],
};

// Roles that use sidebar on desktop
const SIDEBAR_ROLES = ["gerente", "direccion", "super_admin"];

export default function NavBar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = NAV_BY_ROLE[role] || NAV_BY_ROLE.captadora;
  const useSidebar = SIDEBAR_ROLES.includes(role);

  return (
    <nav className={`navbar ${useSidebar ? "navbar-sidebar" : ""}`}>
      <span className="navbar-brand">
        auris<span style={{ opacity: 0.45, fontStyle: "normal" }}>IQ</span>
      </span>
      {items.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        return (
          <a
            key={item.href}
            href={item.href}
            className={`navbar-item ${isActive ? "navbar-active" : ""}`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
