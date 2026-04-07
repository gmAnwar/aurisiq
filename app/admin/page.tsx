"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  analyses_count: number | null;
  access_status: string | null;
  invite_token: string | null;
  role_label_vendedor: string | null;
}

const PLANS = ["starter", "growth", "pro", "scale", "enterprise", "founder"];
const ACCESS_STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  grace: "Gracia",
  read_only: "Solo lectura",
};
const ACCESS_STATUS_CLASS: Record<string, string> = {
  active: "admin-badge-green",
  grace: "admin-badge-yellow",
  read_only: "admin-badge-red",
};

export default function AdminPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missingMigration, setMissingMigration] = useState<"014" | "015" | null>(null);

  // Form state
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newPlan, setNewPlan] = useState("growth");
  const [newRoleLabel, setNewRoleLabel] = useState("Captadora");
  const [slugError, setSlugError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<Organization | null>(null);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["super_admin"]);
      if (!session) return;

      // Try to fetch with all columns. If invite_token or role_label_vendedor
      // doesn't exist yet, retry without them and flag the missing migration.
      let res = await supabase
        .from("organizations")
        .select("id, name, slug, plan, analyses_count, access_status, invite_token, role_label_vendedor")
        .order("created_at", { ascending: false });

      if (res.error && res.error.message?.includes("invite_token")) {
        setMissingMigration("015");
        const r2 = await supabase
          .from("organizations")
          .select("id, name, slug, plan, analyses_count, access_status, role_label_vendedor")
          .order("created_at", { ascending: false });
        res = r2 as typeof res;
      }
      if (res.error && res.error.message?.includes("role_label_vendedor")) {
        setMissingMigration(prev => prev || "014");
        const r3 = await supabase
          .from("organizations")
          .select("id, name, slug, plan, analyses_count, access_status")
          .order("created_at", { ascending: false });
        res = r3 as typeof res;
      }

      if (res.error) {
        setError(res.error.message);
        setLoading(false);
        return;
      }

      setOrgs((res.data || []) as Organization[]);
      setLoading(false);
    }
    load();
  }, []);

  // Auto-suggest slug from name
  function handleNameChange(v: string) {
    setNewName(v);
    if (!slugManuallyEdited) {
      const auto = v.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      setNewSlug(auto);
    }
  }

  function handleSlugChange(v: string) {
    setSlugManuallyEdited(true);
    setNewSlug(v.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  }

  // Validate slug uniqueness on blur
  async function validateSlug() {
    if (!newSlug) { setSlugError("Slug requerido"); return false; }
    const { data } = await supabase.from("organizations").select("id").eq("slug", newSlug).maybeSingle();
    if (data) { setSlugError("Este slug ya existe"); return false; }
    setSlugError("");
    return true;
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const ok = await validateSlug();
    if (!ok) return;

    setCreating(true);
    setCreatedOrg(null);

    const payload: Record<string, unknown> = {
      name: newName.trim(),
      slug: newSlug,
      plan: newPlan,
      access_status: "active",
    };

    // Try to insert with role_label_vendedor; fall back if column missing
    let { data, error: insErr } = await supabase
      .from("organizations")
      .insert({ ...payload, role_label_vendedor: newRoleLabel })
      .select()
      .single();

    if (insErr && insErr.message?.includes("role_label_vendedor")) {
      const retry = await supabase.from("organizations").insert(payload).select().single();
      data = retry.data;
      insErr = retry.error;
    }

    if (insErr) {
      setError("Error al crear: " + insErr.message);
      setCreating(false);
      return;
    }

    if (data) {
      const newOrg = data as Organization;
      setCreatedOrg(newOrg);
      setOrgs(prev => [newOrg, ...prev]);
      // Reset form
      setNewName("");
      setNewSlug("");
      setSlugManuallyEdited(false);
      setNewPlan("growth");
      setNewRoleLabel("Captadora");
    }
    setCreating(false);
  }

  function buildTeamLink(token: string | null): string | null {
    if (!token) return null;
    return `https://app.aurisiq.io/join/${token}`;
  }

  async function copyTeamLink(token: string | null, orgId: string) {
    const link = buildTeamLink(token);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedFor(orgId);
      setTimeout(() => setCopiedFor(null), 1500);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="g1-wrapper"><div className="g1-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div></div>
    );
  }

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Admin — Organizaciones</h1>
        </div>

        {missingMigration && (
          <div className="message-box message-error" style={{ marginBottom: 16 }}>
            <p>Migración pendiente: {missingMigration}. Corre el archivo SQL en Supabase para habilitar TeamLink completo.</p>
          </div>
        )}

        {error && (
          <div className="message-box message-error" style={{ marginBottom: 16 }}>
            <p>{error}</p>
          </div>
        )}

        {/* Section 1: Orgs table */}
        <div className="g1-section">
          <h2 className="g1-section-title">Organizaciones activas ({orgs.length})</h2>
          <div className="admin-table">
            <div className="admin-table-header">
              <span>Nombre</span>
              <span>Slug</span>
              <span>Plan</span>
              <span>Análisis</span>
              <span>Estado</span>
              <span>TeamLink</span>
            </div>
            {orgs.map(o => (
              <div key={o.id} className="admin-table-row">
                <span className="admin-cell-name">{o.name}</span>
                <span className="admin-cell-slug">{o.slug}</span>
                <span className="admin-cell-plan">{o.plan || "—"}</span>
                <span className="admin-cell-count">{o.analyses_count || 0}</span>
                <span>
                  <span className={`admin-badge ${ACCESS_STATUS_CLASS[o.access_status || "active"] || ""}`}>
                    {ACCESS_STATUS_LABEL[o.access_status || "active"] || o.access_status}
                  </span>
                </span>
                <span>
                  {o.invite_token ? (
                    <button className="admin-copy-btn" onClick={() => copyTeamLink(o.invite_token, o.id)}>
                      {copiedFor === o.id ? "Copiado ✓" : "Copiar TeamLink"}
                    </button>
                  ) : (
                    <span className="admin-no-token">Sin token</span>
                  )}
                </span>
              </div>
            ))}
            {orgs.length === 0 && <div className="g1-empty">Sin organizaciones todavía.</div>}
          </div>
        </div>

        {/* Section 2: Create form */}
        <div className="g1-section">
          <h2 className="g1-section-title">Crear nueva organización</h2>

          {createdOrg && (
            <div className="admin-created-box">
              <p className="admin-created-title">✓ Organización creada: {createdOrg.name}</p>
              {createdOrg.invite_token && (
                <div className="admin-created-link-row">
                  <input className="input-field" readOnly value={buildTeamLink(createdOrg.invite_token) || ""} />
                  <button className="btn-submit" style={{ marginTop: 0, flex: "none", minWidth: "auto", padding: "10px 16px" }} onClick={() => copyTeamLink(createdOrg.invite_token, createdOrg.id)}>
                    {copiedFor === createdOrg.id ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>
              )}
              {!createdOrg.invite_token && (
                <p className="c2-hint">El TeamLink no está disponible — corre la migración 015 primero.</p>
              )}
            </div>
          )}

          <div className="admin-form">
            <div className="input-group">
              <label className="input-label">Nombre</label>
              <input
                className="input-field"
                value={newName}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Ej. Mi Inmobiliaria"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Slug (identificador técnico)</label>
              <input
                className="input-field"
                value={newSlug}
                onChange={e => handleSlugChange(e.target.value)}
                onBlur={validateSlug}
                placeholder="mi_inmobiliaria"
              />
              {slugError && <p className="c2-rec-error">{slugError}</p>}
            </div>

            <div className="input-group">
              <label className="input-label">Plan</label>
              <select className="input-field c2-select" value={newPlan} onChange={e => setNewPlan(e.target.value)}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="input-group">
              <label className="input-label">Etiqueta del rol vendedor</label>
              <input
                className="input-field"
                value={newRoleLabel}
                onChange={e => setNewRoleLabel(e.target.value)}
                placeholder="Captadora, Ejecutivo, Asesor..."
              />
              <p className="c2-hint">Cómo se llama el rol técnico &lsquo;captadora&rsquo; en la UI de esta organización.</p>
            </div>

            <button className="btn-submit" onClick={handleCreate} disabled={creating || !newName || !newSlug || !!slugError}>
              {creating ? "Creando..." : "Crear organización"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
