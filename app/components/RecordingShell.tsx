"use client";

import { useState, useEffect } from "react";
import { RecordingProvider } from "../contexts/RecordingContext";
import { FunnelStagesProvider, useFunnelStages } from "../contexts/FunnelStagesContext";
import RecordingBar from "./RecordingBar";
import RecordingsBanner from "./RecordingsBanner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession, type UserSession } from "../../lib/auth";
import { resolveGrabarCta } from "../../lib/cta-routing";

const ALWAYS_HIDE_PREFIX = ["/admin", "/login", "/auth", "/direccion", "/join", "/signup", "/forgot-password", "/reset-password"];
const ALWAYS_HIDE_EXACT = ["/analisis/nueva", "/grabar"];

function MobileFAB({ session }: { session: UserSession | null }) {
  const pathname = usePathname();
  const { funnelStages } = useFunnelStages();

  if (!pathname) return null;

  // No session = no FAB (pre-auth pages)
  if (!session) return null;

  // Always hide on these routes
  if (ALWAYS_HIDE_EXACT.includes(pathname) || ALWAYS_HIDE_PREFIX.some(p => pathname.startsWith(p))) {
    return null;
  }

  const hasCaptadora = session?.roles?.includes("captadora") ?? false;

  // Hide on /equipo/* only if user is NOT also a captadora
  if (pathname.startsWith("/equipo") && !hasCaptadora) {
    return null;
  }

  const cta = resolveGrabarCta({ hasCaptadora, funnelStages, orgSlug: session.organizationSlug });
  if (!cta.showCta) return null;

  const href = cta.href ?? "/analisis/nueva";
  const ariaLabel = cta.ariaLabel || "Grabar";

  return (
    <Link href={href} className="c1-fab" aria-label={ariaLabel}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
    </Link>
  );
}

export default function RecordingShell({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    getSession().then(s => {
      if (s) setSession(s);
    });
  }, []);

  // Limitation: super_admin switching to another org via the navbar selector
  // will see the NavBar CTA based on funnel_stages of their base org
  // (session.organizationId), not the active org. Low-frequency case, deferred.
  return (
    <RecordingProvider>
      <FunnelStagesProvider organizationId={session?.organizationId}>
        <RecordingBar />
        <RecordingsBanner />
        {children}
        <MobileFAB session={session} />
      </FunnelStagesProvider>
    </RecordingProvider>
  );
}
