"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAllRecordings, type PendingRecording } from "../../lib/recordings-queue";
import { getSession } from "../../lib/auth";

export default function RecordingsBanner() {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState(0);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const session = await getSession();
      if (!session || !mounted) return;
      const all = await getAllRecordings(session.userId);
      const active = all.filter(r => r.status !== "completed" && !r.incomplete);
      setPending(active.length);
      setErrors(active.filter(r => r.status === "error").length);
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (pending === 0) return null;
  if (pathname === "/grabaciones-pendientes") return null;

  const hasErrors = errors > 0;

  return (
    <Link
      href="/grabaciones-pendientes"
      className={`rec-banner ${hasErrors ? "rec-banner--error" : ""}`}
    >
      {hasErrors
        ? `${errors} grabacion${errors > 1 ? "es" : ""} con error - descargar como backup`
        : `${pending} grabacion${pending > 1 ? "es" : ""} pendiente${pending > 1 ? "s" : ""}`
      }
    </Link>
  );
}
