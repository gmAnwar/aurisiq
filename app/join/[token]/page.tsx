"use client";

import { useState, useEffect, use } from "react";
import { supabase } from "../../../lib/supabase";

interface Org {
  id: string;
  name: string;
  slug: string;
  role_label_vendedor: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Roles that can be picked during onboarding (super_admin and agencia excluded)
const SELECTABLE_ROLES: { value: string; label: string }[] = [
  { value: "captadora", label: "Vendedor / Captadora / Ejecutivo" },
  { value: "gerente", label: "Gerente de equipo" },
  { value: "direccion", label: "Dirección" },
];

type Step = "loading" | "invalid" | "signup" | "questions" | "saving" | "error";

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [step, setStep] = useState<Step>("loading");
  const [org, setOrg] = useState<Org | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Auth state
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  // Signup step
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [signingUp, setSigningUp] = useState(false);

  // 3 questions
  const [name, setName] = useState("");
  const [chosenRole, setChosenRole] = useState("captadora");
  const [city, setCity] = useState("");

  useEffect(() => {
    async function init() {
      // 1. Validate token format
      if (!UUID_RE.test(token)) {
        setStep("invalid");
        setErrorMsg("Este link de invitación no es válido. Pide uno nuevo a tu gerente.");
        return;
      }

      // 2. Look up org by token
      let orgRes = await supabase
        .from("organizations")
        .select("id, name, slug, role_label_vendedor")
        .eq("invite_token", token)
        .maybeSingle();

      if (orgRes.error && orgRes.error.message?.includes("invite_token")) {
        // Migration 015 not applied
        setStep("invalid");
        setErrorMsg("El sistema de invitaciones aún no está habilitado. Contacta a soporte.");
        return;
      }

      if (orgRes.error && orgRes.error.message?.includes("role_label_vendedor")) {
        const retry = await supabase
          .from("organizations")
          .select("id, name, slug")
          .eq("invite_token", token)
          .maybeSingle();
        orgRes = retry as typeof orgRes;
      }

      if (!orgRes.data) {
        setStep("invalid");
        setErrorMsg("Este link de invitación no es válido. Pide uno nuevo a tu gerente.");
        return;
      }

      setOrg(orgRes.data as Org);

      // 3. Check existing session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAuthedUserId(session.user.id);
        setAuthedEmail(session.user.email || null);

        // 4. Check if user already exists in users table for any org
        const { data: existing } = await supabase
          .from("users")
          .select("id, organization_id, name")
          .eq("id", session.user.id)
          .maybeSingle();

        if (existing && existing.organization_id !== orgRes.data.id) {
          setStep("error");
          setErrorMsg("Este correo ya está registrado en otra organización. Contacta soporte.");
          return;
        }

        // Pre-fill name if known
        if (existing?.name) setName(existing.name);
        setStep("questions");
      } else {
        setStep("signup");
      }
    }

    init();
  }, [token]);

  async function handleSignup() {
    if (!email.trim() || !password) return;
    setErrorMsg("");
    if (password.length < 8) {
      setErrorMsg("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== passwordConfirm) {
      setErrorMsg("Las contraseñas no coinciden");
      return;
    }
    setSigningUp(true);

    try {
      // 1. Create auth user via service-role endpoint
      const res = await fetch("/api/join/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, invite_token: token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body.error || "Error al crear la cuenta");
        setSigningUp(false);
        return;
      }

      // 2. Sign in with the new credentials
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr || !signInData?.session) {
        setErrorMsg("Cuenta creada pero no pudimos iniciar sesión: " + (signInErr?.message || "intenta entrar desde /login"));
        setSigningUp(false);
        return;
      }

      setAuthedUserId(signInData.session.user.id);
      setAuthedEmail(signInData.session.user.email || null);
      setStep("questions");
    } catch (e) {
      setErrorMsg("Error de red: " + (e instanceof Error ? e.message : "desconocido"));
    }
    setSigningUp(false);
  }

  async function saveOnboarding() {
    if (!authedUserId || !org) return;
    if (!name.trim() || !chosenRole || !city.trim()) {
      setErrorMsg("Por favor completa las 3 preguntas.");
      return;
    }
    setStep("saving");
    setErrorMsg("");

    // Upsert via service-role endpoint (bypasses RLS which blocks
    // the browser client for newly-invited users).
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const accessToken = s?.access_token;
      const res = await fetch("/api/join/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          token,
          name: name.trim(),
          role: chosenRole,
          city: city.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStep("questions");
        setErrorMsg("Error al guardar: " + (body.error || `HTTP ${res.status}`));
        return;
      }
    } catch (e) {
      setStep("questions");
      setErrorMsg("Error de red al guardar: " + (e instanceof Error ? e.message : "desconocido"));
      return;
    }

    // Redirect to root — which then routes by role
    window.location.href = "/";
  }

  if (step === "loading") {
    return (
      <div className="join-wrapper">
        <div className="join-card">
          <div className="skeleton-block skeleton-title" />
          <div className="skeleton-block skeleton-textarea" />
        </div>
      </div>
    );
  }

  if (step === "invalid" || step === "error") {
    return (
      <div className="join-wrapper">
        <div className="join-card">
          <h1 className="join-title">No pudimos validar tu invitación</h1>
          <p className="join-error">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (step === "signup") {
    return (
      <div className="join-wrapper">
        <div className="join-card">
          <p className="join-eyebrow">Únete a</p>
          <h1 className="join-title">{org?.name}</h1>
          <p className="join-sub">Crea tu cuenta para empezar a usar aurisIQ.</p>
          <div className="input-group">
            <label className="input-label">Correo</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              autoComplete="email"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Contraseña</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Confirmar contraseña</label>
            <input
              className="input-field"
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="Repite la contraseña"
              autoComplete="new-password"
              minLength={8}
              onKeyDown={e => { if (e.key === "Enter") handleSignup(); }}
            />
          </div>
          {errorMsg && <p className="join-error">{errorMsg}</p>}
          <button className="btn-submit" onClick={handleSignup} disabled={signingUp || !email.trim() || !password || !passwordConfirm}>
            {signingUp ? "Creando cuenta..." : "Continuar"}
          </button>
        </div>
      </div>
    );
  }

  // step === "questions" or "saving"
  return (
    <div className="join-wrapper">
      <div className="join-card">
        <p className="join-eyebrow">Únete a {org?.name}</p>
        <h1 className="join-title">Cuéntanos sobre ti</h1>

        <div className="input-group">
          <label className="input-label">¿Cómo te llamas?</label>
          <input
            className="input-field"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre completo"
          />
        </div>

        <div className="input-group">
          <label className="input-label">¿Cuál es tu rol?</label>
          <select className="input-field c2-select" value={chosenRole} onChange={e => setChosenRole(e.target.value)}>
            {SELECTABLE_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="input-group">
          <label className="input-label">¿En qué ciudad trabajas?</label>
          <input
            className="input-field"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="Ej. Monterrey"
          />
        </div>

        {errorMsg && <p className="join-error">{errorMsg}</p>}

        <button
          className="btn-submit"
          onClick={saveOnboarding}
          disabled={step === "saving" || !name.trim() || !city.trim()}
        >
          {step === "saving" ? "Guardando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}
