"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import NavBar from "./NavBar";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

// Must match SIDEBAR_ROLES in NavBar.tsx
const SIDEBAR_ROLES = ["gerente", "direccion", "agencia"];

export default function AuthNav() {
  const [role, setRole] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);
  const pathname = usePathname();

  const isLoginPage = pathname === "/";

  useEffect(() => {
    if (isLoginPage) return;

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

        const { data } = await supabase
          .from("users")
          .select("role, name, email, organization_id")
          .eq("id", session.user.id)
          .single();

        if (!data) return;
        r = data.role;
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
      }

      document.body.classList.add("has-nav");
      if (SIDEBAR_ROLES.includes(r)) {
        document.body.classList.add("has-sidebar");
      }
    }

    loadRole();

    return () => { document.body.classList.remove("has-nav", "has-sidebar"); };
  }, [isLoginPage]);

  if (isLoginPage || !role) return null;

  return <NavBar role={role} userName={userName} userEmail={userEmail} orgSlug={orgSlug} roleLabelVendedor={roleLabelVendedor} />;
}
