"use client";

import { useState, useEffect } from "react";
import { RecordingProvider } from "../contexts/RecordingContext";
import RecordingBar from "./RecordingBar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession } from "../../lib/auth";

const ALWAYS_HIDE = ["/analisis/nueva", "/admin", "/login", "/auth", "/direccion"];

function MobileFAB() {
  const pathname = usePathname();
  const [hasCaptadora, setHasCaptadora] = useState(false);

  useEffect(() => {
    getSession().then(s => {
      if (s) setHasCaptadora(s.roles.includes("captadora"));
    });
  }, []);

  if (!pathname) return null;

  // Always hide on these routes
  if (pathname === "/analisis/nueva" || ALWAYS_HIDE.some(p => p !== "/analisis/nueva" && pathname.startsWith(p))) {
    return null;
  }

  // Hide on /equipo/* only if user is NOT also a captadora
  if (pathname.startsWith("/equipo") && !hasCaptadora) {
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
