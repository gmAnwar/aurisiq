"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface User { id: string; name: string; email: string; role: string; last_sign_in_at: string | null; active: boolean; }

export default function CuentaPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("captadora");
  const [inviteMsg, setInviteMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const [usersRes, orgRes] = await Promise.all([
        supabase.from("users").select("id, name, email, role, last_sign_in_at, active")
          .eq("organization_id", me.organization_id).order("name"),
        supabase.from("organizations").select("name, plan, analysis_count_month, access_status")
          .eq("id", me.organization_id).single(),
      ]);

      setUsers(usersRes.data || []);
      setOrg(orgRes.data);
      setLoading(false);
    }
    load();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviteMsg("");
    // In production: create invitation record + send email
    setInviteMsg(`Invitación creada para ${inviteEmail} como ${inviteRole}. Funcionalidad de envío disponible en Etapa 2.`);
    setInviteEmail("");
  };

  const handleDeactivate = async (userId: string) => {
    await supabase.from("users").update({ active: false }).eq("id", userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: false } : u));
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const roleLabels: Record<string, string> = { captadora: "Captadora", gerente: "Gerente", direccion: "Dirección", agencia: "Agencia", super_admin: "Super Admin" };

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Configuración de Cuenta</h1>
        </div>

        {/* Users */}
        <div className="g1-section">
          <h2 className="g1-section-title">Usuarios</h2>
          <div className="g1-ranking">
            <div className="d4-user-header">
              <span>Nombre</span><span>Email</span><span>Rol</span><span>Último acceso</span><span></span>
            </div>
            {users.map(u => (
              <div key={u.id} className={`d4-user-row ${!u.active ? "d4-inactive" : ""}`}>
                <span className="g1-rank-name">{u.name}</span>
                <span className="d4-email">{u.email}</span>
                <span className="d4-role">{roleLabels[u.role] || u.role}</span>
                <span className="d4-last-access">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "Nunca"}
                </span>
                <span>
                  {u.active ? (
                    <button className="d4-deactivate-btn" onClick={() => handleDeactivate(u.id)}>Desactivar</button>
                  ) : (
                    <span className="d4-inactive-label">Inactivo</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Invite */}
        <div className="g1-section">
          <h2 className="g1-section-title">Invitar usuario</h2>
          <div className="d4-invite">
            <input className="input-field" type="email" placeholder="email@empresa.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            <select className="input-field c2-select" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              <option value="captadora">Captadora</option>
              <option value="gerente">Gerente</option>
              <option value="direccion">Dirección</option>
              <option value="agencia">Agencia</option>
            </select>
            <button className="btn-submit" onClick={handleInvite}>Invitar</button>
          </div>
          {inviteMsg && <div className="message-box message-success" style={{ marginTop: 12 }}><p>{inviteMsg}</p></div>}
        </div>

        {/* Billing */}
        {org && (
          <div className="g1-section">
            <h2 className="g1-section-title">Facturación</h2>
            <div className="d4-billing">
              <div className="d4-billing-row"><span>Plan actual</span><span className="d4-billing-value">{(org.plan as string || "").toUpperCase()}</span></div>
              <div className="d4-billing-row"><span>Análisis este mes</span><span className="d4-billing-value">{org.analysis_count_month as number || 0}</span></div>
              <div className="d4-billing-row"><span>Estado</span><span className="d4-billing-value">{org.access_status as string}</span></div>
            </div>
          </div>
        )}

        <a href="/direccion" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
