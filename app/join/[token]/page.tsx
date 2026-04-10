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

type Step = "loading" | "invalid" | "needs_email" | "email_sent" | "questions" | "saving" | "error";

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [step, setStep] = useState<Step>("loading");
  const [org, setOrg] = useState<Org | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Auth state
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  // Email step
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);

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
        setStep("needs_email");
      }
    }

    init();
  }, [token]);

  async function sendMagicLink() {
    if (!email.trim()) return;
    setSendingLink(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/join/${token}`,
      },
    });
    setSendingLink(false);
    if (error) {
      setErrorMsg("No se pudo enviar el link: " + error.message);
      return;
    }
    setStep("email_sent");
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

  if (step === "needs_email") {
    return (
      <div className="join-wrapper">
        <div className="join-card">
          <p className="join-eyebrow">Te invitaron a</p>
          <h1 className="join-title">{org?.name}</h1>
          <p className="join-sub">Para empezar, escribe tu correo. Te enviaremos un link para entrar sin contraseña.</p>
          <div className="input-group">
            <label className="input-label">Correo</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              onKeyDown={e => { if (e.key === "Enter") sendMagicLink(); }}
            />
          </div>
          <button className="btn-submit" onClick={sendMagicLink} disabled={sendingLink || !email.trim()}>
            {sendingLink ? "Enviando..." : "Continuar"}
          </button>
          {errorMsg && <p className="join-error" style={{ marginTop: 12 }}>{errorMsg}</p>}
        </div>
      </div>
    );
  }

  if (step === "email_sent") {
    return (
      <div className="join-wrapper">
        <div className="join-card">
          <h1 className="join-title">Revisa tu correo</h1>
          <p className="join-sub">Te enviamos un link a <strong>{email}</strong>. Ábrelo desde este mismo dispositivo para continuar.</p>
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
