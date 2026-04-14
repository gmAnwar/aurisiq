"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { getOrgTimezone, monthStart as getMonthStart } from "../../../lib/dates";
import { getRoleLabel } from "../../../lib/roleLabel";

interface User { id: string; name: string; email: string; role: string; roles?: string[] | null; last_sign_in_at: string | null; active: boolean; }

export default function CuentaPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [orgId, setOrgId] = useState("");
  const [monthlyCount, setMonthlyCount] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("captadora");
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };
      setOrgId(session.organizationId);
      setOrgSlug(session.organizationSlug);
      setRoleLabelVendedor(session.roleLabelVendedor);

      const tz = await getOrgTimezone(me.organization_id);
      const ms = getMonthStart(tz);

      const [usersRes, orgRes, countRes] = await Promise.all([
        supabase.from("users").select("id, name, email, role, roles, last_sign_in_at, active")
          .eq("organization_id", me.organization_id).order("name"),
        supabase.from("organizations").select("name, plan, access_status")
          .eq("id", me.organization_id).single(),
        supabase.from("analyses").select("id", { count: "exact", head: true })
          .eq("organization_id", me.organization_id).eq("status", "completado")
          .gte("created_at", ms),
      ]);

      setUsers(usersRes.data || []);
      setOrg(orgRes.data);
      setMonthlyCount(countRes.count || 0);
      setLoading(false);
    }
    load();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviteMsg("");
    setInviteLink("");
    setCopied(false);

    // Create invitation record in Supabase
    const { data: inv, error: invErr } = await supabase.from("invitations").insert({
      email: inviteEmail,
      role: inviteRole,
      organization_id: orgId,
    }).select("id").single();

    if (invErr) {
      setInviteMsg(`Error al crear invitación: ${invErr.message}`);
      return;
    }

    const link = `${window.location.origin}/?invite=${inv?.id || "pending"}`;
    setInviteLink(link);
    setInviteMsg(`Invitación creada para ${inviteEmail} como ${inviteRole}.`);
    setInviteEmail("");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeactivate = async (userId: string) => {
    await supabase.from("users").update({ active: false }).eq("id", userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: false } : u));
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const orgCtx = { slug: orgSlug, role_label_vendedor: roleLabelVendedor };

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
                <span className="d4-role">{u.roles && u.roles.length > 0 ? u.roles.map(r => getRoleLabel(r, orgCtx)).join(", ") : getRoleLabel(u.role, orgCtx)}</span>
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
              <option value="captadora">{getRoleLabel("captadora", orgCtx)}</option>
              <option value="gerente">Gerente</option>
              <option value="direccion">Dirección</option>
              <option value="agencia">Agencia</option>
            </select>
            <button className="btn-submit" onClick={handleInvite}>Invitar</button>
          </div>
          {inviteMsg && <div className="message-box message-success" style={{ marginTop: 12 }}><p>{inviteMsg}</p></div>}
          {inviteLink && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <input className="input-field" readOnly value={inviteLink} style={{ flex: 1, fontSize: 11 }} />
              <button className="btn-submit" style={{ flex: "none", minWidth: "auto", marginTop: 0, padding: "10px 16px" }} onClick={handleCopyLink}>
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          )}
        </div>

        {/* Billing */}
        {org && (() => {
          const tierLimits: Record<string, number | null> = { starter: 50, growth: 200, pro: 500, scale: 1500, enterprise: null, founder: 50 };
          const plan = (org.plan as string) || "starter";
          const used = monthlyCount;
          const limit = tierLimits[plan];
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const status = org.access_status as string;
          const statusColor = status === "active" ? "var(--green)" : status === "grace" ? "var(--gold)" : "var(--red)";
          return (
            <div className="g1-section">
              <h2 className="g1-section-title">Facturación</h2>
              <div className="d4-billing">
                <div className="d4-billing-row"><span>Plan actual</span><span className="d4-billing-value">{plan.toUpperCase()}</span></div>
                <div className="d4-billing-row">
                  <span>Análisis este mes</span>
                  <span className="d4-billing-value">{used} / {limit !== null ? limit : "∞"}</span>
                </div>
                {limit && (
                  <div className="d4-billing-row" style={{ flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Uso</span><span className="d4-billing-value">{pct}%</span></div>
                    <div className="c3-phase-bar-bg"><div className="c3-phase-bar-fill" style={{ width: `${pct}%`, background: pct > 90 ? "var(--red)" : pct > 70 ? "var(--gold)" : "var(--green)" }} /></div>
                  </div>
                )}
                <div className="d4-billing-row"><span>Estado</span><span className="d4-billing-value" style={{ color: statusColor, textTransform: "capitalize" }}>{status}</span></div>
              </div>
            </div>
          );
        })()}

        <a href="/direccion" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
