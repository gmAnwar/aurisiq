export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: "center" }}>
      <div className="auth-header">
        <h1 className="auth-title">404</h1>
        <p className="auth-subtitle">Página no encontrada</p>
      </div>
      <p style={{ fontSize: 14, color: "var(--ink-light)", lineHeight: 1.6, marginBottom: 24 }}>
        La página que buscas no existe o fue movida.
      </p>
      <a href="/" className="btn-submit" style={{ textDecoration: "none", display: "flex", justifyContent: "center" }}>
        Volver al inicio
      </a>
    </div>
  );
}
