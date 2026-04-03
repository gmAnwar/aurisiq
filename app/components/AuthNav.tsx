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
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data } = await supabase
          .from("users")
          .select("role, name, email")
          .eq("id", session.user.id)
          .single();

        if (!data) return;
        r = data.role;
        setRole(r);
        setUserName(data.name || "");
        setUserEmail(data.email || session.user.email || "");
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

  return <NavBar role={role} userName={userName} userEmail={userEmail} />;
}
