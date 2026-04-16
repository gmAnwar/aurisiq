"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { getAccessToken } from "../../lib/auth-token";
import ScorecardEditor from "./ScorecardEditor";
import TrackersCRUD from "../components/TrackersCRUD";

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
  roles?: string[] | null;
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
  scorecard_id: string | null;
}

interface SpeechVersionRow {
  id: string;
  organization_id: string;
  version_number: number;
  published: boolean | null;
  created_at: string;
  content: unknown;
}

interface StageRow {
  id: string;
  organization_id: string;
  scorecard_id: string | null;
  name: string;
  stage_type: string;
  order_index: number;
  active: boolean;
}

interface ScorecardRow {
  id: string;
  organization_id: string | null;
  name: string;
  version: string;
  vertical: string;
  active: boolean;
}

interface AdminTracker { id: string; organization_id: string | null; code: string; label: string; icon: string; description: string; speaker: string; sort_order: number; active: boolean; }

interface ScorecardTemplate {
  id: string;
  name: string;
  vertical_slug: string;
  description: string | null;
  structure: Record<string, unknown>;
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
type Tab = "orgs" | "users" | "analyses" | "speech" | "embudo" | "trackers";

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
  const [stages, setStages] = useState<StageRow[]>([]);
  const [scorecards, setScorecards] = useState<ScorecardRow[]>([]);
  const [templates, setTemplates] = useState<ScorecardTemplate[]>([]);
  const [trackerOrgFilter, setTrackerOrgFilter] = useState<string>("");

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

  // Embudo state
  const [embudoOrgFilter, setEmbudoOrgFilter] = useState<string>("");
  const [showStageModal, setShowStageModal] = useState(false);
  const [editingStage, setEditingStage] = useState<StageRow | null>(null);
  const [stageName, setStageName] = useState("");
  const [stageType, setStageType] = useState("llamada");
  const [stageScorecardId, setStageScorecardId] = useState("");
  const [savingStage, setSavingStage] = useState(false);
  const [archivingStageId, setArchivingStageId] = useState<string | null>(null);
  const [editingScorecardId, setEditingScorecardId] = useState<string | null>(null);
  const [editingScorecardStructure, setEditingScorecardStructure] = useState<Record<string, unknown> | null>(null);
  const [loadingScorecardEditor, setLoadingScorecardEditor] = useState(false);

  // Create scorecard from template
  const [showCreateScorecard, setShowCreateScorecard] = useState(false);
  const [newScName, setNewScName] = useState("");
  const [newScVersion, setNewScVersion] = useState("");
  const [newScTemplateId, setNewScTemplateId] = useState("");
  const [creatingScorecard, setCreatingScorecard] = useState(false);
  const [archivingScorecardId, setArchivingScorecardId] = useState<string | null>(null);
  const [archivingScorecard, setArchivingScorecard] = useState(false);

  // Destructive confirm (analyses delete)
  const [pendingDeleteAnalysisId, setPendingDeleteAnalysisId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Create user form
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("captadora");
  const [newUserRoles, setNewUserRoles] = useState<string[]>(["captadora"]);
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
    const token = await getAccessToken();
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
    setStages((body.funnel_stages || []) as StageRow[]);
    setScorecards((body.scorecards || []) as ScorecardRow[]);
    setTemplates((body.scorecard_templates || []) as ScorecardTemplate[]);
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
      const token = await getAccessToken();
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

  async function changeUserRoles(id: string, roles: string[]) {
    await updateUser(id, { roles });
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
      const token = await getAccessToken();
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
          role: newUserRoles[0] || "captadora",
          roles: newUserRoles,
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
      setNewUserRoles(["captadora"]);
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
      const token = await getAccessToken();
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
      const token = await getAccessToken();
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
      const token = await getAccessToken();
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
      const token = await getAccessToken();
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

  // ─── Embudo CRUD ─────────────────────────────
  const filteredStages = embudoOrgFilter
    ? stages.filter(s => s.organization_id === embudoOrgFilter)
    : stages;
  const orgScorecards = (orgId: string) => scorecards.filter(s => s.organization_id === orgId && s.active);

  function openStageModal(stage?: StageRow) {
    if (stage) {
      setEditingStage(stage);
      setStageName(stage.name);
      setStageType(stage.stage_type);
      setStageScorecardId(stage.scorecard_id || "");
    } else {
      setEditingStage(null);
      setStageName("");
      setStageType("llamada");
      setStageScorecardId("");
    }
    setShowStageModal(true);
  }

  async function saveStage() {
    const targetOrg = editingStage?.organization_id || embudoOrgFilter;
    if (!targetOrg || !stageName.trim()) return;
    setSavingStage(true);
    const token = await getAccessToken();
    if (!token) { setSavingStage(false); return; }

    if (editingStage) {
      const { error } = await supabase.from("funnel_stages").update({
        name: stageName.trim(),
        stage_type: stageType,
        scorecard_id: stageScorecardId || null,
      }).eq("id", editingStage.id);
      if (error) { showToast({ type: "err", msg: error.message }); }
      else { showToast({ type: "ok", msg: "Etapa actualizada" }); }
    } else {
      const maxIdx = filteredStages.filter(s => s.active).reduce((m, s) => Math.max(m, s.order_index), 0);
      const { error } = await supabase.from("funnel_stages").insert({
        organization_id: targetOrg,
        name: stageName.trim(),
        stage_type: stageType,
        scorecard_id: stageScorecardId || null,
        order_index: maxIdx + 1,
      });
      if (error) { showToast({ type: "err", msg: error.message }); }
      else { showToast({ type: "ok", msg: "Etapa creada" }); }
    }
    setSavingStage(false);
    setShowStageModal(false);
    await loadAllData();
  }

  async function archiveStage(stageId: string) {
    const { error } = await supabase.from("funnel_stages").update({ active: false }).eq("id", stageId);
    if (error) { showToast({ type: "err", msg: error.message }); }
    else { showToast({ type: "ok", msg: "Etapa archivada" }); }
    setArchivingStageId(null);
    await loadAllData();
  }

  async function reorderStage(stageId: string, direction: "up" | "down") {
    const orgStages = filteredStages.filter(s => s.active).sort((a, b) => a.order_index - b.order_index);
    const idx = orgStages.findIndex(s => s.id === stageId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= orgStages.length) return;
    const a = orgStages[idx];
    const b = orgStages[swapIdx];
    await Promise.all([
      supabase.from("funnel_stages").update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from("funnel_stages").update({ order_index: a.order_index }).eq("id", b.id),
    ]);
    await loadAllData();
  }

  async function openScorecardEditor(scorecardId: string) {
    setLoadingScorecardEditor(true);
    setEditingScorecardId(scorecardId);
    const { data } = await supabase.from("scorecards").select("structure").eq("id", scorecardId).single();
    setEditingScorecardStructure((data?.structure as Record<string, unknown>) || {});
    setLoadingScorecardEditor(false);
  }

  async function createScorecardFromTemplate() {
    if (!embudoOrgFilter || !newScTemplateId || !newScName.trim() || !newScVersion.trim()) return;
    setCreatingScorecard(true);
    const tpl = templates.find(t => t.id === newScTemplateId);
    if (!tpl) { setCreatingScorecard(false); return; }

    // Derive legacy phases JSONB from structure.phases
    const structurePhases = (tpl.structure as Record<string, unknown>)?.phases;
    const phases = Array.isArray(structurePhases)
      ? structurePhases.map((p: Record<string, unknown>) => ({
          name: p.name || "",
          max_score: p.max_score || 0,
          criteria: p.criteria || [],
        }))
      : [];

    // Build minimal prompt_template from structure
    const objective = (tpl.structure as Record<string, unknown>)?.objective || "";
    const promptTemplate = `Evalúa la conversación según el scorecard "${newScName.trim()}". ${objective}`;

    const { error } = await supabase.from("scorecards").insert({
      organization_id: embudoOrgFilter,
      template_id: newScTemplateId,
      name: newScName.trim(),
      version: newScVersion.trim(),
      vertical: tpl.vertical_slug,
      structure: tpl.structure,
      phases,
      prompt_template: promptTemplate,
      active: true,
    });

    if (error) { showToast({ type: "err", msg: error.message }); }
    else { showToast({ type: "ok", msg: "Scorecard creado" }); }
    setCreatingScorecard(false);
    setShowCreateScorecard(false);
    setNewScName("");
    setNewScVersion("");
    setNewScTemplateId("");
    await loadAllData();
  }

  async function archiveScorecard(scorecardId: string) {
    setArchivingScorecard(true);
    const { error } = await supabase.from("scorecards").update({ active: false }).eq("id", scorecardId);
    if (error) { showToast({ type: "err", msg: error.message }); }
    else { showToast({ type: "ok", msg: "Scorecard archivado" }); }
    setArchivingScorecard(false);
    setArchivingScorecardId(null);
    await loadAllData();
  }

  function stageAnalysisCount(stageId: string) {
    return analyses.filter(a => a.organization_id === (editingStage?.organization_id || embudoOrgFilter)).length;
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
    { key: "embudo", label: "Embudo", count: stages.filter(s => s.active).length },
    { key: "trackers", label: "Trackers", count: 0 },
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
              {(() => {
                const showOrgsCol = filteredUsers.some(u => {
                  const r = u.roles && u.roles.length > 0 ? u.roles : [u.role];
                  return r.includes("agencia") || r.includes("super_admin");
                });
                return (<>
              <div className="adm-table-head">
                <span style={{ flex: 1.5 }}>Nombre</span>
                <span style={{ flex: 2 }}>Email</span>
                <span style={{ flex: 0.8 }}>Rol</span>
                <span style={{ flex: 1 }}>Org</span>
                <span style={{ flex: 0.5 }}>Estado</span>
                {showOrgsCol && <span style={{ flex: 0.5 }}>Orgs</span>}
                <span style={{ flex: 0.3 }} />
              </div>
              {filteredUsers.map(u => {
                const memberships = userMemberships(u.id);
                return (
                  <div key={u.id}>
                    <div className="adm-table-row" onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}>
                      <span style={{ flex: 1.5, fontWeight: 500 }}>{u.name}</span>
                      <span style={{ flex: 2, color: "#737373" }}>{u.email}</span>
                      <span style={{ flex: 0.8, display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
                        {(u.roles && u.roles.length > 0 ? u.roles : [u.role]).map(r => (
                          <span key={r} className="adm-role-badge" style={{ background: `${ROLE_COLOR[r] || "#6b7280"}18`, color: ROLE_COLOR[r] || "#6b7280", fontSize: 11 }}>{r}</span>
                        ))}
                        {savingUserId === u.id && <span style={{ fontSize: 10 }}>...</span>}
                        {savedUserId === u.id && <span style={{ fontSize: 10, color: "#16a34a" }}>✓</span>}
                      </span>
                      <span style={{ flex: 1, color: "#737373", fontSize: 13 }}>{orgName(u.organization_id)}</span>
                      <span style={{ flex: 0.5 }}>
                        <span className={`adm-status-dot ${u.active ? "adm-dot-green" : "adm-dot-gray"}`} />
                      </span>
                      {showOrgsCol && <span style={{ flex: 0.5, fontSize: 13, color: "#737373" }}>{(() => { const r = u.roles && u.roles.length > 0 ? u.roles : [u.role]; return r.includes("agencia") || r.includes("super_admin") ? memberships.length : "—"; })()}</span>}
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
                          <div className="input-group" style={{ margin: 0, minWidth: 200 }}>
                            <label className="input-label" style={{ fontSize: 11 }}>Roles</label>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                              {(u.roles && u.roles.length > 0 ? u.roles : [u.role]).map(r => (
                                <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 12, background: `${ROLE_COLOR[r] || "#6b7280"}18`, color: ROLE_COLOR[r] || "#6b7280" }}>
                                  {r}
                                  {(u.roles || [u.role]).length > 1 && (
                                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }} onClick={() => changeUserRoles(u.id, (u.roles || [u.role]).filter(x => x !== r))} title="Quitar rol">&times;</button>
                                  )}
                                </span>
                              ))}
                              {(() => {
                                const currentRoles = u.roles && u.roles.length > 0 ? u.roles : [u.role];
                                const available = ROLES.filter(r => !currentRoles.includes(r));
                                if (available.length === 0) return null;
                                return (
                                  <select style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer" }} value="" onChange={e => { if (e.target.value) changeUserRoles(u.id, [...currentRoles, e.target.value]); }}>
                                    <option value="">+ rol</option>
                                    {available.map(r => <option key={r} value={r}>{r}</option>)}
                                  </select>
                                );
                              })()}
                            </div>
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
                        {(() => { const ur = u.roles && u.roles.length > 0 ? u.roles : [u.role]; return ur.includes("agencia") || ur.includes("super_admin"); })() && (
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
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              </>); })()}
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

      {/* ===== TAB: Embudo ===== */}
      {activeTab === "embudo" && (
        <div className="adm-section">
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <select className="input-field" value={embudoOrgFilter} onChange={e => setEmbudoOrgFilter(e.target.value)} style={{ maxWidth: 260, padding: "6px 10px" }}>
              <option value="">Todas las orgs</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {embudoOrgFilter && (
              <>
                <button className="adm-btn-primary" onClick={() => openStageModal()}>+ Agregar etapa</button>
                <button className="adm-btn-ghost" style={{ fontSize: 13 }} onClick={() => setShowCreateScorecard(true)}>+ Crear scorecard</button>
              </>
            )}
          </div>

          {!embudoOrgFilter ? (
            <div className="adm-empty"><p>Selecciona una organización para ver su embudo.</p></div>
          ) : filteredStages.length === 0 ? (
            <div className="adm-empty"><p>Sin etapas configuradas para esta org.</p></div>
          ) : (
            <div className="adm-table">
              <div className="adm-table-head">
                <span style={{ flex: 0.3 }}>#</span>
                <span style={{ flex: 1.2 }}>Nombre</span>
                <span style={{ flex: 0.7 }}>Tipo</span>
                <span style={{ flex: 1.2 }}>Scorecard</span>
                <span style={{ flex: 0.5 }}>Estado</span>
                <span style={{ flex: 1 }} />
              </div>
              {filteredStages.sort((a, b) => a.order_index - b.order_index).map((s, i) => {
                const sc = scorecards.find(c => c.id === s.scorecard_id);
                return (
                  <div key={s.id} className="adm-table-row" style={{ opacity: s.active ? 1 : 0.5 }}>
                    <span style={{ flex: 0.3, fontWeight: 600 }}>{s.order_index}</span>
                    <span style={{ flex: 1.2 }}>{s.name}</span>
                    <span style={{ flex: 0.7 }}>
                      <span className={`adm-pill ${s.stage_type === "llamada" ? "admin-badge-blue" : s.stage_type === "visita" ? "admin-badge-green" : "admin-badge-yellow"}`}>
                        {s.stage_type}
                      </span>
                    </span>
                    <span style={{ flex: 1.2, fontSize: 13, color: sc ? "var(--ink)" : "#a8a29e" }}>
                      {sc ? `${sc.name} (${sc.version})` : "— sin scorecard"}
                    </span>
                    <span style={{ flex: 0.5 }}>
                      <span className={`adm-pill ${s.active ? "admin-badge-green" : "admin-badge-red"}`}>
                        {s.active ? "Activa" : "Archivada"}
                      </span>
                    </span>
                    <span className="adm-row-actions" style={{ flex: 1, display: "flex", gap: 4 }}>
                      {s.active && (
                        <>
                          <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => reorderStage(s.id, "up")} disabled={i === 0} title="Subir">▲</button>
                          <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => reorderStage(s.id, "down")} disabled={i === filteredStages.filter(x => x.active).length - 1} title="Bajar">▼</button>
                          <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => openStageModal(s)}>Editar</button>
                          {s.scorecard_id && <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => openScorecardEditor(s.scorecard_id!)}>Scorecard</button>}
                          <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 12 }} onClick={() => setArchivingStageId(s.id)}>Archivar</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Scorecard list per org */}
          {embudoOrgFilter && (() => {
            const orgSc = scorecards.filter(s => s.organization_id === embudoOrgFilter);
            if (orgSc.length === 0) return null;
            return (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>Scorecards de esta org</h3>
                <div className="adm-table">
                  <div className="adm-table-head">
                    <span style={{ flex: 1.3 }}>Nombre</span>
                    <span style={{ flex: 0.6 }}>Versión</span>
                    <span style={{ flex: 0.6 }}>Vertical</span>
                    <span style={{ flex: 0.6 }}>Etapas</span>
                    <span style={{ flex: 0.6 }}>Análisis</span>
                    <span style={{ flex: 0.5 }}>Estado</span>
                    <span style={{ flex: 0.5 }} />
                  </div>
                  {orgSc.map(sc => {
                    const activeStagesUsing = stages.filter(s => s.scorecard_id === sc.id && s.active);
                    const analysisCount = analyses.filter(a => a.scorecard_id === sc.id).length;
                    return (
                      <div key={sc.id} className="adm-table-row" style={{ opacity: sc.active ? 1 : 0.5 }}>
                        <span style={{ flex: 1.3 }}>{sc.name}</span>
                        <span style={{ flex: 0.6, fontSize: 13 }}>{sc.version}</span>
                        <span style={{ flex: 0.6, fontSize: 13 }}>{sc.vertical}</span>
                        <span style={{ flex: 0.6, fontSize: 13 }}>{activeStagesUsing.length} etapa{activeStagesUsing.length !== 1 ? "s" : ""}</span>
                        <span style={{ flex: 0.6, fontSize: 13 }}>{analysisCount}</span>
                        <span style={{ flex: 0.5 }}>
                          <span className={`adm-pill ${sc.active ? "admin-badge-green" : "admin-badge-red"}`}>{sc.active ? "Activo" : "Archivado"}</span>
                        </span>
                        <span className="adm-row-actions" style={{ flex: 0.5 }}>
                          {sc.active && (
                            <>
                              <button className="adm-btn-ghost" style={{ fontSize: 12 }} onClick={() => openScorecardEditor(sc.id)}>Editar</button>
                              <button className="adm-btn-ghost adm-btn-danger-text" style={{ fontSize: 12 }} onClick={() => setArchivingScorecardId(sc.id)}>Archivar</button>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Scorecard editor inline panel */}
      {editingScorecardId && activeTab === "embudo" && (
        <div className="adm-section" style={{ borderTop: "2px solid var(--accent, #4f46e5)", marginTop: 8 }}>
          {loadingScorecardEditor ? (
            <p style={{ padding: 16, color: "#737373" }}>Cargando scorecard…</p>
          ) : editingScorecardStructure ? (
            <ScorecardEditor
              scorecardId={editingScorecardId}
              scorecardName={scorecards.find(s => s.id === editingScorecardId)?.name || "Scorecard"}
              initialStructure={editingScorecardStructure as Record<string, unknown>}
              onClose={() => { setEditingScorecardId(null); setEditingScorecardStructure(null); }}
              onSaved={() => loadAllData()}
            />
          ) : null}
        </div>
      )}

      {/* Archive confirmation dialog */}
      {archivingStageId && (() => {
        const s = stages.find(x => x.id === archivingStageId);
        const count = analyses.filter(a => a.organization_id === s?.organization_id).length;
        return (
          <>
            <div className="adm-overlay" onClick={() => setArchivingStageId(null)} />
            <div className="adm-slideover" style={{ maxWidth: 420 }}>
              <div className="adm-slideover-header">
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Archivar etapa</h2>
                <button className="adm-icon-btn" onClick={() => setArchivingStageId(null)}>&times;</button>
              </div>
              <div className="adm-slideover-body">
                <p style={{ fontSize: 14, margin: "0 0 12px" }}>
                  Esta organización tiene <strong>{count}</strong> análisis históricos. Archivar la etapa
                  &quot;{s?.name}&quot; la ocultará de usuarios nuevos pero los análisis pasados se preservan.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="adm-btn-primary" style={{ background: "#ef4444" }} onClick={() => archiveStage(archivingStageId)}>Confirmar archivar</button>
                  <button className="adm-btn-ghost" onClick={() => setArchivingStageId(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Archive scorecard confirmation */}
      {archivingScorecardId && (() => {
        const sc = scorecards.find(x => x.id === archivingScorecardId);
        const activeStagesUsing = stages.filter(s => s.scorecard_id === archivingScorecardId && s.active);
        const analysisCount = analyses.filter(a => a.scorecard_id === archivingScorecardId).length;
        const blocked = activeStagesUsing.length > 0;
        return (
          <>
            <div className="adm-overlay" onClick={() => setArchivingScorecardId(null)} />
            <div className="adm-slideover" style={{ maxWidth: 440 }}>
              <div className="adm-slideover-header">
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Archivar scorecard</h2>
                <button className="adm-icon-btn" onClick={() => setArchivingScorecardId(null)}>&times;</button>
              </div>
              <div className="adm-slideover-body">
                {blocked ? (
                  <>
                    <p style={{ fontSize: 14, margin: "0 0 8px", color: "#dc2626" }}>
                      No se puede archivar &quot;{sc?.name}&quot; porque está asignado a {activeStagesUsing.length} etapa{activeStagesUsing.length !== 1 ? "s" : ""} activa{activeStagesUsing.length !== 1 ? "s" : ""}:
                    </p>
                    <ul style={{ fontSize: 13, margin: "0 0 12px", paddingLeft: 20 }}>
                      {activeStagesUsing.map(s => <li key={s.id}>{s.name}</li>)}
                    </ul>
                    <p style={{ fontSize: 13, color: "#737373", margin: "0 0 12px" }}>
                      Desasocia el scorecard de estas etapas primero (edita cada etapa y quita el scorecard).
                    </p>
                    <button className="adm-btn-ghost" onClick={() => setArchivingScorecardId(null)} style={{ width: "100%" }}>Entendido</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 14, margin: "0 0 12px" }}>
                      Este scorecard tiene <strong>{analysisCount}</strong> análisis históricos.
                      Archivarlo lo ocultará del dropdown de etapas pero los análisis pasados se preservan.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="adm-btn-primary" style={{ background: "#ef4444" }} onClick={() => archiveScorecard(archivingScorecardId)} disabled={archivingScorecard}>
                        {archivingScorecard ? "Archivando..." : "Confirmar archivar"}
                      </button>
                      <button className="adm-btn-ghost" onClick={() => setArchivingScorecardId(null)}>Cancelar</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Stage create/edit modal */}
      {showStageModal && (
        <>
          <div className="adm-overlay" onClick={() => setShowStageModal(false)} />
          <div className="adm-slideover" style={{ maxWidth: 420 }}>
            <div className="adm-slideover-header">
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{editingStage ? "Editar etapa" : "Nueva etapa"}</h2>
              <button className="adm-icon-btn" onClick={() => setShowStageModal(false)}>&times;</button>
            </div>
            <div className="adm-slideover-body">
              <div className="input-group">
                <label className="input-label">Nombre</label>
                <input className="input-field" value={stageName} onChange={e => setStageName(e.target.value)} placeholder="Ej: Llamada inicial" />
              </div>
              <div className="input-group">
                <label className="input-label">Tipo</label>
                <select className="input-field" value={stageType} onChange={e => setStageType(e.target.value)}>
                  <option value="llamada">Llamada</option>
                  <option value="visita">Visita</option>
                  <option value="cierre">Cierre</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Scorecard asociado</label>
                <select className="input-field" value={stageScorecardId} onChange={e => setStageScorecardId(e.target.value)}>
                  <option value="">— Sin scorecard</option>
                  {orgScorecards(editingStage?.organization_id || embudoOrgFilter).map(sc => (
                    <option key={sc.id} value={sc.id}>{sc.name} ({sc.version})</option>
                  ))}
                </select>
              </div>
              <button className="adm-btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={saveStage} disabled={savingStage || !stageName.trim()}>
                {savingStage ? "Guardando..." : editingStage ? "Guardar cambios" : "Crear etapa"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ===== TAB: Trackers ===== */}
      {activeTab === "trackers" && (
        <div className="adm-section">
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <select className="input-field" value={trackerOrgFilter} onChange={e => setTrackerOrgFilter(e.target.value)} style={{ maxWidth: 260, padding: "6px 10px" }}>
              <option value="">Universales (sistema)</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <TrackersCRUD
            orgId={trackerOrgFilter || null}
            showUniversals={!trackerOrgFilter}
            readOnlyUniversals={false}
            onChanged={() => loadAllData()}
          />
        </div>
      )}

      {/* ===== Modal: Crear scorecard desde template ===== */}
      {showCreateScorecard && (
        <>
          <div className="adm-overlay" onClick={() => setShowCreateScorecard(false)} />
          <div className="adm-slideover" style={{ maxWidth: 420 }}>
            <div className="adm-slideover-header">
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Nuevo scorecard</h2>
              <button className="adm-icon-btn" onClick={() => setShowCreateScorecard(false)}>&times;</button>
            </div>
            <div className="adm-slideover-body">
              <p style={{ fontSize: 13, color: "#737373", margin: "0 0 12px" }}>
                Clona la estructura de un template base. Después podrás editarlo desde el editor de scorecard.
              </p>
              <div className="input-group">
                <label className="input-label">Template base</label>
                <select className="input-field" value={newScTemplateId} onChange={e => setNewScTemplateId(e.target.value)}>
                  <option value="">Selecciona template</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.vertical_slug})</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Nombre del scorecard</label>
                <input className="input-field" value={newScName} onChange={e => setNewScName(e.target.value)} placeholder="Ej: V5C Seguimiento" />
              </div>
              <div className="input-group">
                <label className="input-label">Versión</label>
                <input className="input-field" value={newScVersion} onChange={e => setNewScVersion(e.target.value)} placeholder="Ej: V5C" />
              </div>
              <button className="adm-btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={createScorecardFromTemplate} disabled={creatingScorecard || !newScTemplateId || !newScName.trim() || !newScVersion.trim()}>
                {creatingScorecard ? "Creando..." : "Crear scorecard"}
              </button>
            </div>
          </div>
        </>
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
              <div className="input-group">
                <label className="input-label">Roles</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {newUserRoles.map(r => (
                    <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 12, background: `${ROLE_COLOR[r] || "#6b7280"}18`, color: ROLE_COLOR[r] || "#6b7280" }}>
                      {r}
                      {newUserRoles.length > 1 && (
                        <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }} onClick={() => setNewUserRoles(newUserRoles.filter(x => x !== r))}>&times;</button>
                      )}
                    </span>
                  ))}
                  {(() => {
                    const available = ROLES.filter(r => !newUserRoles.includes(r));
                    if (available.length === 0) return null;
                    return (
                      <select style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #d1d5db", borderRadius: 4, background: "#fff" }} value="" onChange={e => { if (e.target.value) setNewUserRoles([...newUserRoles, e.target.value]); }}>
                        <option value="">+ rol</option>
                        {available.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    );
                  })()}
                </div>
              </div>
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
