"use client";

import { RecordingProvider } from "../contexts/RecordingContext";
import RecordingBar from "./RecordingBar";
import Link from "next/link";
import { usePathname } from "next/navigation";

function MobileFAB() {
  const pathname = usePathname();
  // Hide on /analisis/nueva, /equipo/*, /admin/*, /login, /auth/*
  if (!pathname || pathname === "/analisis/nueva" || pathname.startsWith("/equipo") || pathname.startsWith("/admin") || pathname.startsWith("/login") || pathname.startsWith("/auth") || pathname.startsWith("/direccion")) {
    return null;
  }
  return (
    <Link href="/analisis/nueva" className="c1-fab" aria-label="Nueva llamada">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
    </Link>
  );
}

export default function RecordingShell({ children }: { children: React.ReactNode }) {
  return (
    <RecordingProvider>
      <RecordingBar />
      {children}
      <MobileFAB />
    </RecordingProvider>
  );
}
