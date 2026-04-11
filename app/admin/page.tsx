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
type Tab = "orgs" | "users" | "analyses" | "speech";

const ROLE_COLOR: Record<string, string> = {
  captadora: "#3b82f6",
  gerente: "#22c55e",
  direccion: "#06b6d4",
  agencia: "#f59e0b",
  super_admin: "#ef4444",
};

function scoreBadgeClass(score: number | null): string {
  if (score === null) return "adm-score-none";
  if (score >= 75) return "adm-score-green";
  if (score >= 50) return "adm-score-yellow";
  return "adm-score-red";
}

export default function AdminPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [speechVersions, setSpeechVersions] = useState<SpeechVersionRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [activeTab, setActiveTab] = useState<Tab>("orgs");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

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

  // Per-user saving indicator
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);

  // User orgs — loaded with initial data, keyed by user_id
  type Membership = { id: string; user_id: string; organization_id: string; role: string };
  const [allMemberships, setAllMemberships] = useState<Membership[]>([]);
  const [addOrgUserId, setAddOrgUserId] = useState<string | null>(null);
  const [addOrgId, setAddOrgId] = useState("");
  const [addOrgRole, setAddOrgRole] = useState("captadora");

  // Destructive confirm (analyses delete)
  const [pendingDeleteAnalysisId, setPendingDeleteAnalysisId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Create user form
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("captadora");
  const [newUserOrgId, setNewUserOrgId] = useState("");
  const [newUserTraining, setNewUserTraining] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [lastCreatedUserLink, setLastCreatedUserLink] = useState<string | null>(null);
  const [newUserErrors, setNewUserErrors] = useState<{ name?: string; email?: string; org?: string }>({});

  function showToast(t: Toast) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 3000);
  }

  const loadAllData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError("Sin sesión activa"); return; }
    const res = await fetch("/api/admin/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) { setError(body.error || "Error cargando datos"); return; }
    setOrgs((body.orgs || []) as Organization[]);
    setUsers((body.users || []) as UserRow[]);
    setAnalyses((body.analyses || []) as AnalysisRow[]);
    setSpeechVersions((body.speech_versions || []) as SpeechVersionRow[]);
    setAllMemberships((body.memberships || []) as Membership[]);
  }, []);

  const loadOrgs = loadAllData;
  const loadUsers = loadAllData;
  const loadAnalyses = loadAllData;
  const loadSpeech = loadAllData;

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["super_admin"]);
      if (!session) return;
      await loadAllData();
      setLoading(false);
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
  async function updateUser(userId: string, updates: Record<string, unknown>) {
    setSavingUserId(userId);
    setSavedUserId(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ user_id: userId, updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ type: "err", msg: body.error || "Error al actualizar" });
        setSavingUserId(null);
        return;
      }
      // Optimistic update local state
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } as UserRow : u));
      setSavingUserId(null);
      setSavedUserId(userId);
      setTimeout(() => setSavedUserId(prev => prev === userId ? null : prev), 2000);
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
      setSavingUserId(null);
    }
  }

  async function changeUserRole(id: string, role: string) {
    await updateUser(id, { role });
  }
  async function toggleUserActive(u: UserRow) {
    await updateUser(u.id, { active: !u.active });
  }
  async function handleCreateUser() {
    const name = newUserName.trim();
    const email = newUserEmail.trim();
    const errs: { name?: string; email?: string; org?: string } = {};
    if (!name) errs.name = "El nombre es requerido";
    if (!email) errs.email = "El email es requerido";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Ingresa un email válido";
    if (!newUserOrgId) errs.org = "Selecciona una organización";
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
          organization_id: newUserOrgId,
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
      setNewUserTraining(false);
      await loadUsers();
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
    setCreatingUser(false);
  }

  async function toggleTrainingMode(u: UserRow) {
    await updateUser(u.id, { training_mode: !u.training_mode });
  }

  function userMemberships(userId: string) {
    return allMemberships.filter(m => m.user_id === userId);
  }

  async function addUserOrg(userId: string) {
    if (!addOrgId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/user-orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ user_id: userId, organization_id: addOrgId, role: addOrgRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ type: "err", msg: body.error || "Error" }); return; }
      showToast({ type: "ok", msg: "Org agregada" });
      if (body.membership) {
        setAllMemberships(prev => [...prev, body.membership]);
      }
      setAddOrgId("");
      setAddOrgUserId(null);
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error" });
    }
  }

  async function removeUserOrg(membershipId: string) {
    if (!window.confirm("¿Quitar esta organización del usuario?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/user-orgs?id=${encodeURIComponent(membershipId)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); showToast({ type: "err", msg: b.error || "Error" }); return; }
      showToast({ type: "ok", msg: "Org removida" });
      setAllMemberships(prev => prev.filter(m => m.id !== membershipId));
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error" });
    }
  }

  async function resendInvite(u: UserRow) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: u.email, user_id: u.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ type: "err", msg: body.error || "Error al reenviar invitación" });
        return;
      }
      if (body.action_link) {
        try { await navigator.clipboard.writeText(body.action_link); } catch { /* ignore */ }
        showToast({ type: "ok", msg: `Invitación regenerada — link copiado al portapapeles${body.email_sent ? " (email enviado)" : ""}` });
      } else {
        showToast({ type: "ok", msg: "Invitación regenerada" });
      }
    } catch (e) {
      showToast({ type: "err", msg: e instanceof Error ? e.message : "Error de red" });
    }
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
  }
  async function confirmDeleteAnalysis() {
    if (!pendingDeleteAnalysisId) return;
    const targetId = pendingDeleteAnalysisId;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/delete-analysis", {
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
      setAnalyses(prev => prev.filter(a => a.id !== targetId));
      setPendingDeleteAnalysisId(null);
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
      <div className="adm-shell">
        <div className="adm-header"><h1 className="adm-title">Admin</h1></div>
        <div className="adm-skeleton-rows">
          {[1,2,3,4,5].map(i => <div key={i} className="adm-skeleton-row" />)}
        </div>
      </div>
    );
  }

  const filteredUsers = userOrgFilter ? users.filter(u => u.organization_id === userOrgFilter) : users;
  const filteredAnalyses = analyses.filter(a => {
    if (analysisOrgFilter && a.organization_id !== analysisOrgFilter) return false;
    if (analysisDateFilter && a.created_at && !a.created_at.startsWith(analysisDateFilter)) return false;
    return true;
  });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "orgs", label: "Organizaciones", count: orgs.length },
    { key: "users", label: "Usuarios", count: users.length },
    { key: "analyses", label: "Análisis", count: analyses.length },
    { key: "speech", label: "Speech", count: speechVersions.length },
  ];

  return (
    <div className="adm-shell">
      {/* Toast */}
      {toast && (
        <div className={`adm-toast ${toast.type === "ok" ? "adm-toast-ok" : "adm-toast-err"}`}>
          {toast.msg}
        </div>
      )}

      {error && <div className="adm-error">{error}</div>}

      {/* Header + Tabs */}
      <div className="adm-header">
        <h1 className="adm-title">Admin</h1>
        {activeTab === "users" && (
          <button className="adm-btn-primary" onClick={() => setShowCreateUser(true)}>+ Nuevo usuario</button>
        )}
      </div>
      <div className="adm-tabs">
        {tabs.map(t => (
          <button key={t.key} className={`adm-tab ${activeTab === t.key ? "adm-tab-active" : ""}`} onClick={() => setActiveTab(t.key)}>
            {t.label} <span className="adm-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      {/* ===== TAB: Organizaciones ===== */}
      {activeTab === "orgs" && (
        <div className="adm-section">
          {orgs.length === 0 ? (
            <div className="adm-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M12 9v6"/></svg>
              <p>Sin organizaciones</p>
            </div>
          ) : orgs.map(o => (
            <div key={o.id} className="adm-card">
              <div className="adm-card-main">
                <div>
                  <span className="adm-card-name">{o.name}</span>
                  <span className="adm-card-slug">{o.slug}</span>
                </div>
                <div className="adm-card-meta">
                  <span className="adm-pill" style={{ background: "#f3f4f6", color: "#374151" }}>{o.plan || "—"}</span>
                  <span className={`adm-pill ${ACCESS_STATUS_CLASS[o.access_status || "active"] || ""}`}>
                    {ACCESS_STATUS_LABEL[o.access_status || "active"] || o.access_status}
                  </span>
                  <span className="adm-card-stat">{o.analyses_count || 0} análisis</span>
                </div>
                <div className="adm-card-actions">
                  {o.invite_token ? (
                    <button className="adm-btn-ghost" onClick={() => copyTeamLink(o.invite_token, o.id)}>
                      {copiedFor === o.id ? "✓ Copiado" : "Copiar TeamLink"}
                    </button>
                  ) : (
                    <button className="adm-btn-ghost" onClick={() => regenerateTeamLink(o.id)}>Generar TeamLink</button>
                  )}
                  <button className="adm-btn-ghost" onClick={() => startEditOrg(o)}>Editar</button>
                  <button className="adm-btn-ghost" onClick={() => { setActiveTab("users"); setUserOrgFilter(o.id); }}>Ver usuarios</button>
                </div>
              </div>
              {editingOrgId === o.id && (
                <div className="adm-card-edit">
                  <div className="adm-edit-grid">
                    <div className="input-group"><label className="input-label">Nombre</label><input className="input-field" value={editOrgDraft.name || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, name: e.target.value })} /></div>
                    <div className="input-group"><label className="input-label">Plan</label><select className="input-field" value={editOrgDraft.plan || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, plan: e.target.value })}>{PLANS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div className="input-group"><label className="input-label">Estado</label><select className="input-field" value={editOrgDraft.access_status || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, access_status: e.target.value })}>{ACCESS_STATUSES.map(s => <option key={s} value={s}>{ACCESS_STATUS_LABEL[s]}</option>)}</select></div>
                    <div className="input-group"><label className="input-label">Label vendedor</label><input className="input-field" value={editOrgDraft.role_label_vendedor || ""} onChange={e => setEditOrgDraft({ ...editOrgDraft, role_label_vendedor: e.target.value })} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="adm-btn-primary" onClick={() => saveEditOrg(o.id)}>Guardar</button>
                    <button className="adm-btn-ghost" onClick={cancelEditOrg}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Create org form */}
          <details className="adm-details">
            <summary className="adm-details-summary">+ Crear organización</summary>
            <div className="adm-edit-grid" style={{ marginTop: 12 }}>
              <div className="input-group"><label className="input-label">Nombre</label><input className="input-field" value={newName} onChange={e => handleNameChange(e.target.value)} placeholder="Mi Inmobiliaria" /></div>
              <div className="input-group"><label className="input-label">Slug</label><input className="input-field" value={newSlug} onChange={e => handleSlugChange(e.target.value)} onBlur={validateSlug} placeholder="mi_inmobiliaria" />{slugError && <p className="adm-field-err">{slugError}</p>}</div>
              <div className="input-group"><label className="input-label">Plan</label><select className="input-field" value={newPlan} onChange={e => setNewPlan(e.target.value)}>{PLANS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
              <div className="input-group"><label className="input-label">Label vendedor</label><input className="input-field" value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} placeholder="Captadora" /></div>
            </div>
            <button className="adm-btn-primary" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating || !newName || !newSlug || !!slugError}>{creating ? "Creando..." : "Crear"}</button>
            {createdOrg && <p className="adm-success-msg">✓ {createdOrg.name} creada</p>}
          </details>
        </div>
      )}

      {/* ===== TAB: Usuarios ===== */}
      {activeTab === "users" && (
        <div className="adm-section">
          <div style={{ marginBottom: 12 }}>
            <select className="input-field" value={userOrgFilter} onChange={e => setUserOrgFilter(e.target.value)} style={{ maxWidth: 240, padding: "6px 10px" }}>
              <option value="">Todas las orgs</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="adm-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
              <p>Sin usuarios</p>
            </div>
          ) : (
            <div className="adm-table">
              <div className="adm-table-head">
                <span style={{ flex: 1.5 }}>Nombre</span>
                <span style={{ flex: 2 }}>Email</span>
                <span style={{ flex: 0.8 }}>Rol</span>
                <span style={{ flex: 1 }}>Org</span>
                <span style={{ flex: 0.5 }}>Estado</span>
                <span style={{ flex: 0.5 }}>Orgs</span>
                <span style={{ flex: 0.3 }} />
              </div>
              {filteredUsers.map(u => {
                const memberships = userMemberships(u.id);
                return (
                  <div key={u.id}>
                    <div className="adm-table-row" onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}>
                      <span style={{ flex: 1.5, fontWeight: 500 }}>{u.name}</span>
                      <span style={{ flex: 2, color: "#737373" }}>{u.email}</span>
                      <span style={{ flex: 0.8 }}>
                        <span className="adm-role-badge" style={{ background: `${ROLE_COLOR[u.role] || "#6b7280"}18`, color: ROLE_COLOR[u.role] || "#6b7280" }}>{u.role}</span>
                        {savingUserId === u.id && <span style={{ fontSize: 10, marginLeft: 4 }}>...</span>}
                        {savedUserId === u.id && <span style={{ fontSize: 10, marginLeft: 4, color: "#16a34a" }}>✓</span>}
                      </span>
                      <span style={{ flex: 1, color: "#737373", fontSize: 13 }}>{orgName(u.organization_id)}</span>
                      <span style={{ flex: 0.5 }}>
                        <span className={`adm-status-dot ${u.active ? "adm-dot-green" : "adm-dot-gray"}`} />
                      </span>
                      <span style={{ flex: 0.5, fontSize: 13, color: "#737373" }}>{memberships.length}</span>
                      <span className="adm-row-actions" style={{ flex: 0.3 }}>
                        <button className="adm-icon-btn" onClick={e => { e.stopPropagation(); resendInvite(u); }} title="Reenviar invitación">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
                        </button>
                        <button className="adm-icon-btn adm-icon-danger" onClick={e => { e.stopPropagation(); softDeleteUser(u); }} title="Eliminar">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </span>
                    </div>
                    {expandedUserId === u.id && (
                      <div className="adm-row-expand">
                        <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                          <div className="input-group" style={{ margin: 0, minWidth: 120 }}>
                            <label className="input-label" style={{ fontSize: 11 }}>Rol</label>
                            <select className="input-field" value={u.role} onChange={e => changeUserRole(u.id, e.target.value)} style={{ padding: "5px 8px", fontSize: 13 }}>
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                          <div className="input-group" style={{ margin: 0 }}>
                            <label className="input-label" style={{ fontSize: 11 }}>Training</label>
                            <button className="adm-btn-ghost" style={{ padding: "5px 10px", fontSize: 13 }} onClick={() => toggleTrainingMode(u)}>{u.training_mode ? "ON" : "OFF"}</button>
                          </div>
                          <div className="input-group" style={{ margin: 0 }}>
                            <label className="input-label" style={{ fontSize: 11 }}>Activo</label>
                            <button className="adm-btn-ghost" style={{ padding: "5px 10px", fontSize: 13 }} onClick={() => toggleUserActive(u)}>{u.active ? "Sí" : "No"}</button>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "#737373", fontWeight: 500 }}>Orgs:</span>
                          {memberships.map(m => (
                            <span key={m.id} className="adm-org-pill">
                              {orgName(m.organization_id)} <span style={{ opacity: 0.6 }}>({m.role})</span>
                              <button onClick={() => removeUserOrg(m.id)} className="adm-pill-x">&times;</button>
                            </span>
                          ))}
                          {addOrgUserId === u.id ? (
                            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <select className="input-field" value={addOrgId} onChange={e => setAddOrgId(e.target.value)} style={{ padding: "3px 6px", fontSize: 12, width: 120 }}>
                                <option value="">Org...</option>
                                {orgs.filter(o => !memberships.some(m => m.organization_id === o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </select>
                              <select className="input-field" value={addOrgRole} onChange={e => setAddOrgRole(e.target.value)} style={{ padding: "3px 6px", fontSize: 12, width: 90 }}>
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <button className="adm-btn-ghost" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => addUserOrg(u.id)} disabled={!addOrgId}>OK</button>
                              <button className="adm-btn-ghost" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => setAddOrgUserId(null)}>X</button>
                            </span>
                          ) : (
                            <button className="adm-btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => { setAddOrgUserId(u.id); setAddOrgId(""); setAddOrgRole(u.role); }}>+</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: Análisis ===== */}
      {activeTab === "analyses" && (
        <div className="adm-section">
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <select className="input-field" value={analysisOrgFilter} onChange={e => setAnalysisOrgFilter(e.target.value)} style={{ maxWidth: 200, padding: "6px 10px" }}>
              <option value="">Todas las orgs</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input className="input-field" type="date" value={analysisDateFilter} onChange={e => setAnalysisDateFilter(e.target.value)} style={{ maxWidth: 170, padding: "6px 10px" }} />
          </div>

          {filteredAnalyses.length === 0 ? (
            <div className="adm-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <p>Sin análisis</p>
            </div>
          ) : (
            <div className="adm-table">
              <div className="adm-table-head">
                <span style={{ flex: 0.5 }}>Score</span>
                <span style={{ flex: 1.5 }}>Usuario</span>
                <span style={{ flex: 1 }}>Org</span>
                <span style={{ flex: 1 }}>Fecha</span>
                <span style={{ flex: 0.8 }}>Status</span>
                <span style={{ flex: 0.3 }} />
              </div>
              {filteredAnalyses.map(a => (
                <div key={a.id}>
                  <div className="adm-table-row">
                    <span style={{ flex: 0.5 }}>
                      <span className={`adm-score ${scoreBadgeClass(a.score_general)}`}>{a.score_general ?? "—"}</span>
                    </span>
                    <span style={{ flex: 1.5, fontWeight: 500 }}>{userName(a.user_id)}</span>
                    <span style={{ flex: 1, color: "#737373", fontSize: 13 }}>{orgName(a.organization_id)}</span>
                    <span style={{ flex: 1, color: "#737373", fontSize: 13 }}>{a.created_at ? a.created_at.slice(0, 10) : "—"}</span>
                    <span style={{ flex: 0.8, fontSize: 13 }}>{a.status || "—"}</span>
                    <span className="adm-row-actions" style={{ flex: 0.3 }}>
                      <button className="adm-icon-btn adm-icon-danger" onClick={() => requestDeleteAnalysis(a.id)} title="Eliminar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </span>
                  </div>
                  {pendingDeleteAnalysisId === a.id && (
                    <div className="adm-confirm-bar">
                      <span>¿Eliminar este análisis? No se puede deshacer.</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="adm-btn-ghost" onClick={() => setPendingDeleteAnalysisId(null)}>Cancelar</button>
                        <button className="adm-btn-danger" onClick={confirmDeleteAnalysis}>Eliminar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: Speech ===== */}
      {activeTab === "speech" && (
        <div className="adm-section">
          {speechVersions.length === 0 ? (
            <div className="adm-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <p>Sin speech versions</p>
            </div>
          ) : (
            <div className="adm-table">
              <div className="adm-table-head">
                <span style={{ flex: 1.3 }}>Org</span>
                <span style={{ flex: 0.5 }}>Versión</span>
                <span style={{ flex: 0.6 }}>Estado</span>
                <span style={{ flex: 1 }}>Creada</span>
                <span style={{ flex: 1.5 }}>Primera fase</span>
                <span style={{ flex: 0.5 }} />
              </div>
              {speechVersions.map(s => (
                <div key={s.id} className="adm-table-row">
                  <span style={{ flex: 1.3 }}>{orgName(s.organization_id)}</span>
                  <span style={{ flex: 0.5 }}>v{s.version_number}</span>
                  <span style={{ flex: 0.6 }}>
                    <span className={`adm-pill ${s.published ? "admin-badge-green" : "admin-badge-red"}`}>{s.published ? "Pub" : "No"}</span>
                  </span>
                  <span style={{ flex: 1, color: "#737373", fontSize: 13 }}>{s.created_at ? s.created_at.slice(0, 10) : "—"}</span>
                  <span style={{ flex: 1.5, fontSize: 13 }}>{firstPhaseOf(s.content)}</span>
                  <span className="adm-row-actions" style={{ flex: 0.5 }}>
                    {s.published && <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => unpublishSpeech(s.id)}>Despublicar</button>}
                    <button className="adm-icon-btn adm-icon-danger" onClick={() => deleteSpeech(s.id)} title="Eliminar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Slide-over: Crear usuario ===== */}
      {showCreateUser && (
        <>
          <div className="adm-overlay" onClick={() => setShowCreateUser(false)} />
          <div className="adm-slideover">
            <div className="adm-slideover-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Nuevo usuario</h2>
              <button className="adm-icon-btn" onClick={() => setShowCreateUser(false)}>&times;</button>
            </div>
            <div className="adm-slideover-body">
              {lastCreatedUserLink && (
                <div className="adm-success-msg" style={{ marginBottom: 12 }}>
                  ✓ Usuario creado. <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => { navigator.clipboard.writeText(lastCreatedUserLink).catch(() => {}); showToast({ type: "ok", msg: "Link copiado" }); }}>Copiar link de invitación</button>
                </div>
              )}
              <div className="input-group"><label className="input-label">Nombre</label><input className="input-field" value={newUserName} onChange={e => { setNewUserName(e.target.value); if (newUserErrors.name) setNewUserErrors({ ...newUserErrors, name: undefined }); }} placeholder="Elizabeth R." />{newUserErrors.name && <p className="adm-field-err">{newUserErrors.name}</p>}</div>
              <div className="input-group"><label className="input-label">Email</label><input className="input-field" type="email" value={newUserEmail} onChange={e => { setNewUserEmail(e.target.value); if (newUserErrors.email) setNewUserErrors({ ...newUserErrors, email: undefined }); }} placeholder="usuario@empresa.com" />{newUserErrors.email && <p className="adm-field-err">{newUserErrors.email}</p>}</div>
              <div className="input-group"><label className="input-label">Rol</label><select className="input-field" value={newUserRole} onChange={e => setNewUserRole(e.target.value)}><option value="captadora">Captadora</option><option value="gerente">Gerente</option><option value="direccion">Dirección</option><option value="agencia">Agencia</option><option value="super_admin">Super Admin</option></select></div>
              <div className="input-group"><label className="input-label">Organización</label><select className="input-field" value={newUserOrgId} onChange={e => { setNewUserOrgId(e.target.value); if (newUserErrors.org) setNewUserErrors({ ...newUserErrors, org: undefined }); }}><option value="">Selecciona org</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>{newUserErrors.org && <p className="adm-field-err">{newUserErrors.org}</p>}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: "12px 0" }}><input type="checkbox" checked={newUserTraining} onChange={e => setNewUserTraining(e.target.checked)} /><span style={{ fontSize: 13 }}>Modo capacitación</span></label>
              <button className="adm-btn-primary" style={{ width: "100%" }} onClick={handleCreateUser} disabled={creatingUser || !newUserName || !newUserEmail || !newUserOrgId}>{creatingUser ? "Creando..." : "Crear y enviar invitación"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
