"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getTrainingRole, setTrainingRole, getActiveOrgId, setActiveOrgId } from "../../lib/auth";
import NavBar from "./NavBar";

export interface OrgOption { id: string; name: string; }

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

// Must match SIDEBAR_ROLES in NavBar.tsx
const SIDEBAR_ROLES = ["gerente", "direccion", "agencia"];

export default function AuthNav() {
  const [role, setRole] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);
  const [trainingMode, setTrainingMode] = useState(false);
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const pathname = usePathname();

  const isLoginPage = pathname === "/";
  const isJoinPage = pathname?.startsWith("/join/") ?? false;

  useEffect(() => {
    if (isLoginPage || isJoinPage) return;

    async function loadRole() {
      let r = "";
      if (SKIP_AUTH) {
        r = "super_admin";
        setRole(r);
        setUserName("Elizabeth R.");
        setUserEmail("elizabeth@inmobili.demo");
        setOrgSlug("immobili");
        setRoleLabelVendedor("Captadora");
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        let userRes = await supabase
          .from("users")
          .select("role, name, email, organization_id, training_mode")
          .eq("id", session.user.id)
          .single();
        if (userRes.error && userRes.error.message?.includes("training_mode")) {
          userRes = await supabase
            .from("users")
            .select("role, name, email, organization_id")
            .eq("id", session.user.id)
            .single();
        }
        const data = userRes.data as
          | { role: string; name: string; email: string; organization_id: string; training_mode?: boolean | null }
          | null;

        if (!data) return;
        const realRole = data.role;
        const tMode = !!data.training_mode;
        setTrainingMode(tMode);
        const trainingRole = tMode ? getTrainingRole() : null;
        r = trainingRole || realRole;
        setRole(r);
        setUserName(data.name || "");
        setUserEmail(data.email || session.user.email || "");

        // Fetch org data; gracefully handle missing role_label_vendedor column
        let orgRes = await supabase
          .from("organizations")
          .select("slug, role_label_vendedor")
          .eq("id", data.organization_id)
          .maybeSingle();

        if (orgRes.error && orgRes.error.message?.includes("role_label_vendedor")) {
          orgRes = await supabase
            .from("organizations")
            .select("slug")
            .eq("id", data.organization_id)
            .maybeSingle();
        }

        if (orgRes.data) {
          setOrgSlug(orgRes.data.slug || null);
          setRoleLabelVendedor((orgRes.data as { role_label_vendedor?: string | null }).role_label_vendedor || null);
        }

        // Fetch every org the user belongs to (primary + user_organizations).
        // super_admin additionally gets all orgs via /api/admin/data so they
        // can switch beyond their explicit memberships.
        try {
          const meRes = await fetch("/api/me/orgs", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          let opts: OrgOption[] = [];
          if (meRes.ok) {
            const meBody = await meRes.json();
            opts = (meBody.orgs || []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name }));
          }
          if (realRole === "super_admin") {
            const res = await fetch("/api/admin/data", {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
              const body = await res.json();
              const all: OrgOption[] = (body.orgs || []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name }));
              // Merge, preferring super_admin's broader list
              const byId = new Map(all.map(o => [o.id, o]));
              for (const o of opts) if (!byId.has(o.id)) byId.set(o.id, o);
              opts = Array.from(byId.values());
            }
          }
          setOrgOptions(opts);
          const active = getActiveOrgId();
          const current = active && opts.some(o => o.id === active)
            ? active
            : (data.organization_id || opts[0]?.id || null);
          setActiveOrgIdState(current);
          if (current && current !== getActiveOrgId()) setActiveOrgId(current);
        } catch { /* ignore */ }
      }

      document.body.classList.add("has-nav");
      if (SIDEBAR_ROLES.includes(r)) {
        document.body.classList.add("has-sidebar");
      }
    }

    loadRole();

    return () => { document.body.classList.remove("has-nav", "has-sidebar"); };
  }, [isLoginPage, isJoinPage]);

  if (isLoginPage || isJoinPage || !role) return null;

  const handleTrainingRoleChange = (next: string) => {
    setTrainingRole(next);
    window.location.reload();
  };

  const handleActiveOrgChange = (next: string) => {
    setActiveOrgId(next);
    window.location.reload();
  };

  return (
    <NavBar
      role={role}
      userName={userName}
      userEmail={userEmail}
      orgSlug={orgSlug}
      roleLabelVendedor={roleLabelVendedor}
      trainingMode={trainingMode}
      onTrainingRoleChange={handleTrainingRoleChange}
      orgOptions={orgOptions}
      activeOrgId={activeOrgId}
      onActiveOrgChange={handleActiveOrgChange}
    />
  );
}
