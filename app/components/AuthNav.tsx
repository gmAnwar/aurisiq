"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import NavBar from "./NavBar";

export default function AuthNav() {
  const [role, setRole] = useState<string | null>(null);
  const pathname = usePathname();

  // Don't show nav on login page
  const isLoginPage = pathname === "/";

  useEffect(() => {
    if (isLoginPage) return;

    async function loadRole() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setRole(data.role);
        document.body.classList.add("has-nav");
        if (["gerente", "direccion", "super_admin"].includes(data.role)) {
          document.body.classList.add("has-sidebar");
        }
      }
    }

    loadRole();

    return () => { document.body.classList.remove("has-nav", "has-sidebar"); };
  }, [isLoginPage]);

  if (isLoginPage || !role) return null;

  return <NavBar role={role} />;
}
