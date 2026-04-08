"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  analyses_count: number | null;
  analyses_limit?: number | null;
  access_status: string | null;
  invite_token: string | null;
  role_label_vendedor: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  organization_id: string;
  active: boolean | null;
  training_mode: boolean | null;
  created_at: string;
}

interface AnalysisRow {
  id: string;
  organization_id: string;
  user_id: string;
  score_general: number | null;
  clasificacion: string | null;
  status: string | null;
  created_at: string;
}

interface MembershipRow {
  id: string;
  organization_id: string;
  role: string;
}

interface SpeechVersionRow {
  id: string;
  organization_id: string;
  version_number: number;
  published: boolean | null;
  created_at: string;
  content: unknown;
}

const PLANS = ["starter", "growth", "pro", "scale", "enterprise", "founder"];
const ROLES = ["captadora", "gerente", "direccion", "agencia", "super_admin"];
const ACCESS_STATUSES = ["active", "grace", "read_only"];

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

type Toast = { type: "ok" | "err"; msg: string } | null;

export default function AdminPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [speechVersions, setSpeechVersions] = useState<SpeechVersionRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);

  // Create org form
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newPlan, setNewPlan] = useState("growth");
  const [newRoleLabel, setNewRoleLabel] = useState("Captadora");
  const [slugError, setSlugError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<Organization | null>(null);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  // Edit org state
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgDraft, setEditOrgDraft] = useState<Partial<Organization>>({});

  // Filters
  const [userOrgFilter, setUserOrgFilter] = useState<string>("");
  const [analysisOrgFilter, setAnalysisOrgFilter] = useState<string>("");
  const [analysisDateFilter, setAnalysisDateFilter] = useState<string>("");

  // Destructive confirm (analyses delete)
  const [pendingDeleteAnalysisId, setPendingDeleteAnalysisId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Create user form
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("captadora");
  const [newUserOrgIds, setNewUserOrgIds] = useState<string[]>([]);
  const [newUserTraining, setNewUserTraining] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [lastCreatedUserLink, setLastCreatedUserLink] = useState<string | null>(null);
  const [newUserErrors, setNewUserErrors] = useState<{ name?: string; email?: string; org?: string }>({});

  // Memberships panel (per-user)
  const [openUserMembershipsId, setOpenUserMembershipsId] = useState<string | null>(null);
  const [userMemberships, setUserMemberships] = useState<MembershipRow[]>([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [addMembershipOrgId, setAddMembershipOrgId] = useState("");
  const [addMembershipRole, setAddMembershipRole] = useState("captadora");

  function showToast(t: Toast) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 3000);
  }

  const loadAllData = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setError("Sin sesión activa"); return; }
      const res = await fetch("/api/admin/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Error cargando datos (HTTP ${res.status})`);
        return;
      }
      setOrgs((body.orgs || []) as Organization[]);
      setUsers((body.users || []) as UserRow[]);
      setAnalyses((body.analyses || []) as AnalysisRow[]);
      setSpeechVersions((body.speech_versions || []) as SpeechVersionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red cargando datos");
    }
  }, []);

  const loadOrgs = loadAllData;
  const loadUsers = loadAllData;
  const loadAnalyses = loadAllData;
  const loadSpeech = loadAllData;

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["super_admin"]);
      if (!session) return;
      try {
        await loadAllData();
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadAllData]);

  // ----- Helpers -----
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
    } catch { /* ignore */ }
  }

  function orgName(id: string): string {
    return orgs.find(o => o.id === id)?.name || "—";
  }
  function userName(id: string): string {
    return users.find(u => u.id === id)?.name || "—";
  }

  // ----- Create org -----
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
      role_label_vendedor: newRoleLabel,
    };
    const { data, error: insErr } = await supabase
      .from("organizations")
      .insert(payload)
      .select()
      .single();

    if (insErr) {
      showToast({ type: "err", msg: "Error al crear: " + insErr.message });
      setCreating(false);
      return;
    }
    if (data) {
      const newOrg = data as Organization;
      setCreatedOrg(newOrg);
      setOrgs(prev => [newOrg, ...prev]);
      setNewName(""); setNewSlug(""); setSlugManuallyEdited(false);
      setNewPlan("growth"); setNewRoleLabel("Captadora");
      showToast({ type: "ok", msg: "Organización creada" });
    }
    setCreating(false);
  }

  // ----- Edit org -----
  function startEditOrg(o: Organization) {
    setEditingOrgId(o.id);
    setEditOrgDraft({
      name: o.name,
      plan: o.plan,
      access_status: o.access_status,
      role_label_vendedor: o.role_label_vendedor,
    });
  }
  function cancelEditOrg() {
    setEditingOrgId(null);
    setEditOrgDraft({});
  }
  async function saveEditOrg(id: string) {
    const { error: e } = await supabase
      .from("organizations")
      .update({
        name: editOrgDraft.name,
        plan: editOrgDraft.plan,
        access_status: editOrgDraft.access_status,
        role_label_vendedor: editOrgDraft.role_label_vendedor,
      })
      .eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Organización actualizada" });
    setEditingOrgId(null);
    setEditOrgDraft({});
    await loadOrgs();
  }

  async function regenerateTeamLink(id: string) {
    if (!window.confirm("¿Regenerar TeamLink? El link anterior dejará de funcionar.")) return;
    const newToken = (crypto as Crypto & { randomUUID: () => string }).randomUUID();
    const { error: e } = await supabase
      .from("organizations")
      .update({ invite_token: newToken })
      .eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "TeamLink regenerado" });
    await loadOrgs();
  }

  async function resetAnalysesCount(id: string) {
    if (!window.confirm("¿Resetear el contador de análisis a 0 para esta organización?")) return;
    const { error: e } = await supabase
      .from("organizations")
      .update({ analyses_count: 0 })
      .eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Contador reseteado" });
    await loadOrgs();
  }

  // ----- Users -----
  async function changeUserRole(id: string, role: string) {
    const { error: e } = await supabase.from("users").update({ role }).eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Rol actualizado" });
    await loadUsers();
  }
  async function toggleUserActive(u: UserRow) {
    const next = !u.active;
    const { error: e } = await supabase.from("users").update({ active: next }).eq("id", u.id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: next ? "Usuario activado" : "Usuario desactivado" });
    await loadUsers();
  }
  async function handleCreateUser() {
    const name = newUserName.trim();
    const email = newUserEmail.trim();
    const errs: { name?: string; email?: string; org?: string } = {};
    if (!name) errs.name = "El nombre es requerido";
    if (!email) errs.email = "El email es requerido";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Ingresa un email válido";
    if (newUserOrgIds.length === 0) errs.org = "Selecciona al menos una organización";
    setNewUserErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setCreatingUser(true);
    setLastCreatedUserLink(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        showToast({ type: "err", msg: "No hay sesión activa — reingresa para crear usuarios" });
        setCreatingUser(false);
        return;
      }
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim().toLowerCase(),
          role: newUserRole,
          organization_id: newUserOrgIds[0],
          organization_ids: newUserOrgIds,
          training_mode: newUserTraining,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body.detail ? ` (${JSON.stringify(body.detail)})` : "";
        showToast({ type: "err", msg: (body.error || "Error creando usuario") + detail });
        console.error("[create-user] failed", body);
        setCreatingUser(false);
        return;
      }
      showToast({ type: "ok", msg: "Usuario creado — invitación enviada por email" });
      setLastCreatedUserLink(body.action_link || null);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRole("captadora");
      setNewUserOrgIds([]);
      setNewUserTraining(false);
      await loadUsers();
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
    setCreatingUser(false);
  }

  async function openUserMemberships(u: UserRow) {
    if (openUserMembershipsId === u.id) {
      setOpenUserMembershipsId(null);
      setUserMemberships([]);
      return;
    }
    setOpenUserMembershipsId(u.id);
    setMembershipsLoading(true);
    setAddMembershipOrgId("");
    setAddMembershipRole(u.role);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/user-orgs?user_id=${encodeURIComponent(u.id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json();
      if (res.ok) setUserMemberships(body.memberships || []);
      else showToast({ type: "err", msg: body.error || "Error cargando memberships" });
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
    setMembershipsLoading(false);
  }

  async function addMembership(userId: string) {
    if (!addMembershipOrgId) { showToast({ type: "err", msg: "Selecciona una org" }); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/user-orgs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          organization_id: addMembershipOrgId,
          role: addMembershipRole,
        }),
      });
      const body = await res.json();
      if (!res.ok) { showToast({ type: "err", msg: body.error || "Error" }); return; }
      showToast({ type: "ok", msg: "Organización agregada al usuario" });
      setAddMembershipOrgId("");
      // Reload the memberships list
      const u = users.find(x => x.id === userId);
      if (u) await openUserMemberships(u);
      // Re-open (openUserMemberships toggles, so we need a fresh load)
      const res2 = await fetch(`/api/admin/user-orgs?user_id=${encodeURIComponent(userId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body2 = await res2.json();
      if (res2.ok) {
        setOpenUserMembershipsId(userId);
        setUserMemberships(body2.memberships || []);
      }
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
  }

  async function removeMembership(membershipId: string, userId: string) {
    if (!window.confirm("¿Quitar esta organización del usuario?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/user-orgs?id=${encodeURIComponent(membershipId)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ type: "err", msg: body.error || "Error" }); return; }
      showToast({ type: "ok", msg: "Organización removida" });
      setUserMemberships(prev => prev.filter(m => m.id !== membershipId));
      // Keep panel open
      setOpenUserMembershipsId(userId);
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
  }

  async function toggleTrainingMode(u: UserRow) {
    const next = !u.training_mode;
    const { error: e } = await supabase.from("users").update({ training_mode: next }).eq("id", u.id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: next ? "Modo capacitación activado" : "Modo capacitación desactivado" });
    await loadUsers();
  }

  async function softDeleteUser(u: UserRow) {
    if (!window.confirm(`¿Eliminar (soft) a ${u.name}? Se marcará inactive.`)) return;
    const { error: e } = await supabase.from("users").update({ active: false }).eq("id", u.id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Usuario eliminado" });
    await loadUsers();
  }

  // ----- Analyses -----
  function requestDeleteAnalysis(id: string) {
    setPendingDeleteAnalysisId(id);
    setDeleteConfirmText("");
  }
  async function confirmDeleteAnalysis() {
    if (!pendingDeleteAnalysisId) return;
    const targetId = pendingDeleteAnalysisId;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/delete-analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ analysis_id: targetId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ type: "err", msg: body.error || "Error al eliminar" });
        return;
      }
      showToast({ type: "ok", msg: "Análisis eliminado" });
      setPendingDeleteAnalysisId(null);
      setDeleteConfirmText("");
      setAnalyses(prev => prev.filter(a => a.id !== targetId));
      await loadAllData();
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
  }

  // ----- Speech versions -----
  async function unpublishSpeech(id: string) {
    if (!window.confirm("¿Despublicar esta speech version?")) return;
    const { error: e } = await supabase.from("speech_versions").update({ published: false }).eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Speech despublicada" });
    await loadSpeech();
  }
  async function deleteSpeech(id: string) {
    if (!window.confirm("¿Eliminar definitivamente esta speech version?")) return;
    const { error: e } = await supabase.from("speech_versions").delete().eq("id", id);
    if (e) { showToast({ type: "err", msg: e.message }); return; }
    showToast({ type: "ok", msg: "Speech eliminada" });
    await loadSpeech();
  }

  function firstPhaseOf(content: unknown): string {
    try {
      if (Array.isArray(content)) {
        const first = content[0];
        if (first && typeof first === "object") {
          const f = first as Record<string, unknown>;
          return (f.fase as string) || (f.nombre as string) || (f.titulo as string) || "—";
        }
      }
      if (content && typeof content === "object") {
        const c = content as Record<string, unknown>;
        const frases = c.frases;
        if (Array.isArray(frases) && frases.length > 0) {
          const f = frases[0] as Record<string, unknown>;
          return (f.fase as string) || (f.nombre as string) || "—";
        }
        if (Array.isArray(c.fases) && c.fases.length > 0) {
          const f = c.fases[0] as Record<string, unknown>;
          return (f.nombre as string) || "—";
        }
      }
    } catch { /* ignore */ }
    return "—";
  }

  if (loading) {
    return (
      <div className="g1-wrapper"><div className="g1-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div></div>
    );
  }

  const filteredUsers = userOrgFilter ? users.filter(u => u.organization_id === userOrgFilter) : users;
  const filteredAnalyses = analyses.filter(a => {
    if (analysisOrgFilter && a.organization_id !== analysisOrgFilter) return false;
    if (analysisDateFilter && !a.created_at.startsWith(analysisDateFilter)) return false;
    return true;
  });

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Admin — Panel completo</h1>
        </div>

        {error && (
          <div className="message-box message-error" style={{ marginBottom: 16 }}>
            <p>{error}</p>
          </div>
        )}

        {toast && (
          <div
            className={`message-box ${toast.type === "ok" ? "message-success" : "message-error"}`}
            style={{ position: "fixed", top: 16, right: 16, zIndex: 1000, maxWidth: 360 }}
          >
            <p>{toast.msg}</p>
          </div>
        )}

        {/* ===== Section 1: Organizaciones ===== */}
        <div className="g1-section">
          <h2 className="g1-section-title">Organizaciones ({orgs.length})</h2>
          <div className="admin-table">
            <div className="admin-table-header" style={{ gridTemplateColumns: "1.3fr 1fr 0.8fr 1fr 0.9fr 1.4fr 1fr" }}>
              <span>Nombre</span>
              <span>Slug</span>
              <span>Plan</span>
              <span>Análisis</span>
              <span>Estado</span>
              <span>TeamLink</span>
              <span>Acciones</span>
            </div>
            {orgs.map(o => (
              <div key={o.id}>
                <div className="admin-table-row" style={{ gridTemplateColumns: "1.3fr 1fr 0.8fr 1fr 0.9fr 1.4fr 1fr" }}>
                  <span className="admin-cell-name">{o.name}</span>
                  <span className="admin-cell-slug">{o.slug}</span>
                  <span className="admin-cell-plan">{o.plan || "—"}</span>
                  <span className="admin-cell-count">{o.analyses_count || 0}</span>
                  <span>
                    <span className={`admin-badge ${ACCESS_STATUS_CLASS[o.access_status || "active"] || ""}`}>
                      {ACCESS_STATUS_LABEL[o.access_status || "active"] || o.access_status}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {o.invite_token ? (
                      <>
                        <button className="admin-copy-btn" onClick={() => copyTeamLink(o.invite_token, o.id)}>
                          {copiedFor === o.id ? "Copiado ✓" : "Copiar"}
                        </button>
                        <button className="admin-copy-btn" onClick={() => regenerateTeamLink(o.id)}>
                          Regenerar
                        </button>
                      </>
                    ) : (
                      <button className="admin-copy-btn" onClick={() => regenerateTeamLink(o.id)}>
                        Generar TeamLink
                      </button>
                    )}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="admin-copy-btn" onClick={() => startEditOrg(o)}>Editar</button>
                    <button className="admin-copy-btn" onClick={() => { setUserOrgFilter(o.id); window.scrollTo({ top: document.getElementById("sec-users")?.offsetTop || 0, behavior: "smooth" }); }}>
                      Usuarios →
                    </button>
                    <button className="admin-copy-btn" onClick={() => resetAnalysesCount(o.id)}>Reset #</button>
                  </span>
                </div>
                {editingOrgId === o.id && (
                  <div className="admin-table-row" style={{ gridTemplateColumns: "1fr", background: "var(--color-surface-alt, #f9f9f9)", padding: 16 }}>
                    <div className="admin-form" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="input-group">
                        <label className="input-label">Nombre</label>
                        <input className="input-field" value={editOrgDraft.name || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, name: e.target.value })} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Plan</label>
                        <select className="input-field c2-select" value={editOrgDraft.plan || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, plan: e.target.value })}>
                          {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div className="input-group">
                        <label className="input-label">Access status</label>
                        <select className="input-field c2-select" value={editOrgDraft.access_status || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, access_status: e.target.value })}>
                          {ACCESS_STATUSES.map(s => <option key={s} value={s}>{ACCESS_STATUS_LABEL[s]}</option>)}
                        </select>
                      </div>
                      <div className="input-group">
                        <label className="input-label">Etiqueta del rol vendedor</label>
                        <input className="input-field" value={editOrgDraft.role_label_vendedor || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, role_label_vendedor: e.target.value })} />
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                        <button className="btn-submit" style={{ marginTop: 0, flex: "none", padding: "10px 16px" }} onClick={() => saveEditOrg(o.id)}>Guardar</button>
                        <button className="admin-copy-btn" onClick={cancelEditOrg}>Cancelar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {orgs.length === 0 && <div className="g1-empty">Sin organizaciones todavía.</div>}
          </div>
        </div>

        {/* ===== Section 2: Crear organización ===== */}
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
            </div>
          )}

          <div className="admin-form">
            <div className="input-group">
              <label className="input-label">Nombre</label>
              <input className="input-field" value={newName} onChange={e => handleNameChange(e.target.value)} placeholder="Ej. Mi Inmobiliaria" />
            </div>
            <div className="input-group">
              <label className="input-label">Slug</label>
              <input className="input-field" value={newSlug} onChange={e => handleSlugChange(e.target.value)} onBlur={validateSlug} placeholder="mi_inmobiliaria" />
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
              <input className="input-field" value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} placeholder="Captadora, Ejecutivo, Asesor..." />
            </div>
            <button className="btn-submit" onClick={handleCreate} disabled={creating || !newName || !newSlug || !!slugError}>
              {creating ? "Creando..." : "Crear organización"}
            </button>
          </div>
        </div>

        {/* ===== Section 3: Usuarios ===== */}
        <div className="g1-section" id="sec-users">
          <h2 className="g1-section-title">Usuarios ({filteredUsers.length})</h2>

          {/* Crear usuario */}
          <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 600 }}>Crear usuario nuevo</h3>
            {lastCreatedUserLink && (
              <div className="admin-created-box" style={{ marginBottom: 12 }}>
                <p className="admin-created-title">Link de invitación (respaldo):</p>
                <div className="admin-created-link-row">
                  <input className="input-field" readOnly value={lastCreatedUserLink} />
                  <button
                    className="btn-submit"
                    style={{ marginTop: 0, flex: "none", padding: "10px 16px" }}
                    onClick={() => { navigator.clipboard.writeText(lastCreatedUserLink).catch(() => {}); showToast({ type: "ok", msg: "Link copiado" }); }}
                  >
                    Copiar
                  </button>
                </div>
              </div>
            )}
            <div className="admin-form" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="input-group">
                <label className="input-label">Nombre</label>
                <input
                  className="input-field"
                  value={newUserName}
                  onChange={e => { setNewUserName(e.target.value); if (newUserErrors.name) setNewUserErrors({ ...newUserErrors, name: undefined }); }}
                  placeholder="Elizabeth R."
                />
                {newUserErrors.name && <p className="c2-rec-error">{newUserErrors.name}</p>}
              </div>
              <div className="input-group">
                <label className="input-label">Email</label>
                <input
                  className="input-field"
                  type="email"
                  value={newUserEmail}
                  onChange={e => { setNewUserEmail(e.target.value); if (newUserErrors.email) setNewUserErrors({ ...newUserErrors, email: undefined }); }}
                  placeholder="usuario@empresa.com"
                />
                {newUserErrors.email && <p className="c2-rec-error">{newUserErrors.email}</p>}
              </div>
              <div className="input-group">
                <label className="input-label">Rol</label>
                <select className="input-field c2-select" value={newUserRole} onChange={e => setNewUserRole(e.target.value)}>
                  <option value="captadora">Captadora</option>
                  <option value="gerente">Gerente</option>
                  <option value="direccion">Dirección</option>
                  <option value="agencia">Agencia</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                <label className="input-label">Organizaciones (puede pertenecer a varias)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid #e5e5e5", borderRadius: 8, padding: 10, maxHeight: 200, overflowY: "auto" }}>
                  {orgs.length === 0 && <p className="c2-hint">Sin organizaciones disponibles.</p>}
                  {orgs.map(o => {
                    const checked = newUserOrgIds.includes(o.id);
                    return (
                      <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setNewUserErrors({ ...newUserErrors, org: undefined });
                            setNewUserOrgIds(prev =>
                              e.target.checked
                                ? Array.from(new Set([...prev, o.id]))
                                : prev.filter(id => id !== o.id)
                            );
                          }}
                        />
                        <span>{o.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="c2-hint">La primera seleccionada será la org principal del perfil.</p>
                {newUserErrors.org && <p className="c2-rec-error">{newUserErrors.org}</p>}
              </div>
              <div className="input-group" style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={newUserTraining} onChange={e => setNewUserTraining(e.target.checked)} />
                  <span>Modo capacitación (permite cambiar de rol en la app)</span>
                </label>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <button
                  className="btn-submit"
                  onClick={handleCreateUser}
                  disabled={creatingUser || !newUserName || !newUserEmail || newUserOrgIds.length === 0}
                >
                  {creatingUser ? "Creando..." : "Crear usuario y enviar invitación"}
                </button>
              </div>
            </div>
          </div>

          <div className="input-group" style={{ maxWidth: 320 }}>
            <label className="input-label">Filtrar por organización</label>
            <select className="input-field c2-select" value={userOrgFilter} onChange={e => setUserOrgFilter(e.target.value)}>
              <option value="">Todas</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="admin-table">
            <div className="admin-table-header" style={{ gridTemplateColumns: "1.2fr 1.4fr 1fr 1.2fr 0.8fr 1fr 1.2fr" }}>
              <span>Nombre</span>
              <span>Email</span>
              <span>Rol</span>
              <span>Organización</span>
              <span>Activo</span>
              <span>Training</span>
              <span>Acciones</span>
            </div>
            {filteredUsers.map(u => (
              <div key={u.id}>
                <div className="admin-table-row" style={{ gridTemplateColumns: "1.2fr 1.4fr 1fr 1.2fr 0.8fr 1fr 1.4fr" }}>
                  <span className="admin-cell-name">{u.name}</span>
                  <span className="admin-cell-slug">{u.email}</span>
                  <span>
                    <select className="input-field c2-select" value={u.role} onChange={e => changeUserRole(u.id, e.target.value)} style={{ padding: "6px 8px" }}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </span>
                  <span>{orgName(u.organization_id)}</span>
                  <span>
                    <button className="admin-copy-btn" onClick={() => toggleUserActive(u)}>
                      {u.active ? "Activo ✓" : "Inactivo ✗"}
                    </button>
                  </span>
                  <span>
                    <button className="admin-copy-btn" onClick={() => toggleTrainingMode(u)}>
                      {u.training_mode ? "🎓 ON" : "OFF"}
                    </button>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="admin-copy-btn" onClick={() => openUserMemberships(u)}>
                      {openUserMembershipsId === u.id ? "Orgs ▲" : "Orgs"}
                    </button>
                    <button className="admin-copy-btn" onClick={() => softDeleteUser(u)}>Eliminar</button>
                  </span>
                </div>
                {openUserMembershipsId === u.id && (
                  <div className="admin-table-row" style={{ gridTemplateColumns: "1fr", background: "var(--color-surface-alt, #f9f9f9)", padding: 16 }}>
                    <div>
                      <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>Organizaciones de {u.name}</h4>
                      {membershipsLoading ? (
                        <p className="c2-hint">Cargando...</p>
                      ) : (
                        <>
                          {userMemberships.length === 0 && (
                            <p className="c2-hint">Sin memberships. Agrega la primera abajo.</p>
                          )}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                            {userMemberships.map(m => (
                              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", border: "1px solid #e5e5e5", borderRadius: 6, background: "#fff" }}>
                                <strong style={{ flex: 1 }}>{orgName(m.organization_id)}</strong>
                                <span style={{ fontSize: 13, color: "var(--ink-light)" }}>{m.role}</span>
                                <button className="admin-copy-btn" onClick={() => removeMembership(m.id, u.id)}>Quitar</button>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr auto", gap: 8, alignItems: "end" }}>
                            <div className="input-group" style={{ margin: 0 }}>
                              <label className="input-label">Organización</label>
                              <select className="input-field c2-select" value={addMembershipOrgId} onChange={e => setAddMembershipOrgId(e.target.value)}>
                                <option value="">— Elegir org —</option>
                                {orgs
                                  .filter(o => !userMemberships.some(m => m.organization_id === o.id))
                                  .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </select>
                            </div>
                            <div className="input-group" style={{ margin: 0 }}>
                              <label className="input-label">Rol</label>
                              <select className="input-field c2-select" value={addMembershipRole} onChange={e => setAddMembershipRole(e.target.value)}>
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            <button
                              className="btn-submit"
                              style={{ marginTop: 0, flex: "none", padding: "10px 16px" }}
                              onClick={() => addMembership(u.id)}
                              disabled={!addMembershipOrgId}
                            >
                              Agregar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filteredUsers.length === 0 && <div className="g1-empty">Sin usuarios.</div>}
          </div>
        </div>

        {/* ===== Section 4: Análisis ===== */}
        <div className="g1-section">
          <h2 className="g1-section-title">Análisis ({filteredAnalyses.length})</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="input-group" style={{ maxWidth: 260 }}>
              <label className="input-label">Organización</label>
              <select className="input-field c2-select" value={analysisOrgFilter} onChange={e => setAnalysisOrgFilter(e.target.value)}>
                <option value="">Todas</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ maxWidth: 200 }}>
              <label className="input-label">Fecha (YYYY-MM-DD)</label>
              <input className="input-field" type="date" value={analysisDateFilter} onChange={e => setAnalysisDateFilter(e.target.value)} />
            </div>
          </div>
          <div className="admin-table">
            <div className="admin-table-header" style={{ gridTemplateColumns: "1.2fr 1.2fr 0.6fr 1fr 1fr 0.8fr 0.9fr" }}>
              <span>Org</span>
              <span>Usuario</span>
              <span>Score</span>
              <span>Clasif.</span>
              <span>Fecha</span>
              <span>Status</span>
              <span>Acción</span>
            </div>
            {filteredAnalyses.map(a => (
              <div key={a.id}>
                <div className="admin-table-row" style={{ gridTemplateColumns: "1.2fr 1.2fr 0.6fr 1fr 1fr 0.8fr 0.9fr" }}>
                  <span>{orgName(a.organization_id)}</span>
                  <span>{userName(a.user_id)}</span>
                  <span>{a.score_general ?? "—"}</span>
                  <span>{a.clasificacion || "—"}</span>
                  <span>{a.created_at.slice(0, 10)}</span>
                  <span>{a.status || "—"}</span>
                  <span>
                    <button className="admin-copy-btn" onClick={() => requestDeleteAnalysis(a.id)}>Eliminar</button>
                  </span>
                </div>
                {pendingDeleteAnalysisId === a.id && (
                  <div className="admin-table-row" style={{ gridTemplateColumns: "1fr", padding: 14, background: "#fff4f4" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <p style={{ margin: 0, color: "#991b1b" }}>
                        ¿Eliminar este análisis? Esta acción no se puede deshacer.
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="admin-copy-btn" onClick={() => { setPendingDeleteAnalysisId(null); setDeleteConfirmText(""); }}>
                          Cancelar
                        </button>
                        <button
                          className="btn-submit"
                          style={{ marginTop: 0, flex: "none", padding: "8px 16px", background: "#dc2626" }}
                          onClick={confirmDeleteAnalysis}
                        >
                          Confirmar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filteredAnalyses.length === 0 && <div className="g1-empty">Sin análisis.</div>}
          </div>
        </div>

        {/* ===== Section 5: Speech versions ===== */}
        <div className="g1-section">
          <h2 className="g1-section-title">Speech versions ({speechVersions.length})</h2>
          <div className="admin-table">
            <div className="admin-table-header" style={{ gridTemplateColumns: "1.3fr 0.6fr 0.8fr 1fr 1.4fr 1.2fr" }}>
              <span>Org</span>
              <span>Versión</span>
              <span>Publicada</span>
              <span>Creada</span>
              <span>Primera fase</span>
              <span>Acciones</span>
            </div>
            {speechVersions.map(s => (
              <div key={s.id} className="admin-table-row" style={{ gridTemplateColumns: "1.3fr 0.6fr 0.8fr 1fr 1.4fr 1.2fr" }}>
                <span>{orgName(s.organization_id)}</span>
                <span>v{s.version_number}</span>
                <span>
                  <span className={`admin-badge ${s.published ? "admin-badge-green" : "admin-badge-red"}`}>
                    {s.published ? "Sí" : "No"}
                  </span>
                </span>
                <span>{s.created_at.slice(0, 10)}</span>
                <span>{firstPhaseOf(s.content)}</span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.published && (
                    <button className="admin-copy-btn" onClick={() => unpublishSpeech(s.id)}>Despublicar</button>
                  )}
                  <button className="admin-copy-btn" onClick={() => deleteSpeech(s.id)}>Eliminar</button>
                </span>
              </div>
            ))}
            {speechVersions.length === 0 && <div className="g1-empty">Sin speech versions.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
