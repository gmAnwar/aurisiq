"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import NavBar from "./NavBar";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export default function AuthNav() {
  const [role, setRole] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const pathname = usePathname();

  const isLoginPage = pathname === "/";

  useEffect(() => {
    if (isLoginPage) return;

    async function loadRole() {
      if (SKIP_AUTH) {
        setRole("super_admin");
        setUserName("Elizabeth R.");
        setUserEmail("elizabeth@immobili.mx");
        document.body.classList.add("has-nav", "has-sidebar");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from("users")
        .select("role, name, email")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setRole(data.role);
        setUserName(data.name || "");
        setUserEmail(data.email || session.user.email || "");
        document.body.classList.add("has-nav", "has-sidebar");
      }
    }

    loadRole();

    return () => { document.body.classList.remove("has-nav", "has-sidebar"); };
  }, [isLoginPage]);

  if (isLoginPage || !role) return null;

  return <NavBar role={role} userName={userName} userEmail={userEmail} />;
}
