"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { getSession, getHomeForRole } from "../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    // Handle hash errors from Supabase redirect (e.g. otp_expired)
    if (typeof window !== "undefined" && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const error = params.get("error_description");
      if (error) {
        setMessage({ text: decodeURIComponent(error.replace(/\+/g, " ")), error: true });
        window.history.replaceState(null, "", window.location.pathname);
      }
    }

    async function redirectByRole() {
      const user = await getSession();
      if (user) {
        window.location.href = getHomeForRole(user.role);
        return true;
      }
      return false;
    }

    async function checkSession() {
      // Handle code exchange from magic link redirect
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        await redirectByRole();
        return;
      }

      if (await redirectByRole()) return;

      // Listen for auth state changes (handles token in hash from OTP flow)
      supabase.auth.onAuthStateChange(async (event) => {
        if (event === "SIGNED_IN") {
          await redirectByRole();
        }
      });

      setCheckingAuth(false);
    }

    checkSession();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ text: "Email o contraseña incorrectos.", error: true });
      }
      // If successful, onAuthStateChange handles redirect
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setMessage({ text: error.message, error: true });
      } else {
        setMessage({ text: "¡Revisa tu correo! Te enviamos un enlace de acceso.", error: false });
      }
    }

    setLoading(false);
  };

  if (checkingAuth) {
    return (
      <div className="container">
        <div className="auth-header">
          <h1 className="auth-title">AurisIQ</h1>
          <p className="auth-subtitle">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="auth-header">
        <h1 className="auth-title">AurisIQ</h1>
        <p className="auth-subtitle">Accede a tu cuenta</p>
      </div>

      <form className="auth-form" onSubmit={handleLogin}>
        <div className="input-group">
          <label htmlFor="email" className="input-label">
            Email Corporativo
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="tu@empresa.com"
            required
            disabled={loading}
          />
        </div>

        {mode === "password" && (
          <div className="input-group">
            <label htmlFor="password" className="input-label">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Tu contraseña"
              required
              disabled={loading}
            />
          </div>
        )}

        <button type="submit" className="btn-submit" disabled={loading}>
          {loading ? <span className="loader"></span> : mode === "password" ? "Iniciar sesión" : "Enviar enlace de acceso"}
        </button>

        <button
          type="button"
          className="c5-back-link"
          style={{ border: "none", background: "none", cursor: "pointer", width: "100%", fontFamily: "inherit" }}
          onClick={() => { setMode(mode === "password" ? "magic" : "password"); setMessage(null); }}
        >
          {mode === "password" ? "¿Sin contraseña? Enviar magic link" : "Iniciar sesión con contraseña"}
        </button>
      </form>

      {message && (
        <div className={`message-box ${message.error ? "message-error" : "message-success"}`}>
          <p>{message.text}</p>
        </div>
      )}
    </div>
  );
}
