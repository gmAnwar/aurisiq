"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function SetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [exchangeError, setExchangeError] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      const code = searchParams.get("code");
      // If we arrived with a code, exchange it so the session is persisted client-side
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) {
          setExchangeError("No se pudo validar el enlace de invitación: " + exErr.message);
          setLoading(false);
          return;
        }
      }
      // Verify we have a session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setExchangeError("Tu sesión expiró. Pide un nuevo link de invitación.");
      }
      setLoading(false);
    }
    init();
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setSubmitting(true);
    const { error: upErr } = await supabase.auth.updateUser({ password });
    if (upErr) {
      setError(upErr.message);
      setSubmitting(false);
      return;
    }
    router.replace("/analisis");
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
      <div className="g1-container" style={{ maxWidth: 440 }}>
        <div className="g1-header">
          <h1 className="g1-title">Crea tu contraseña</h1>
          <p className="g1-subtitle">Úsala para entrar a aurisIQ cada vez.</p>
        </div>

        {exchangeError ? (
          <div className="message-box message-error">
            <p>{exchangeError}</p>
          </div>
        ) : (
          <form className="admin-form" onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="input-label">Nueva contraseña</label>
              <input
                className="input-field"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label">Confirmar contraseña</label>
              <input
                className="input-field"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {error && <p className="c2-rec-error">{error}</p>}

            <button className="btn-submit" type="submit" disabled={submitting || !password || !confirm}>
              {submitting ? "Guardando..." : "Guardar y entrar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /></div></div>}>
      <SetPasswordInner />
    </Suspense>
  );
}
