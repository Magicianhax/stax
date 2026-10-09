// Static offline fallback shown when a navigation fails with no connection.
// Fully static (no client data deps) so the service worker precaches it cleanly. The service
// worker serves it AT the URL that failed, so reloading that URL is what "picking up" means: an
// inline script (no JS chunk may be cached offline) reloads the moment the connection is back,
// checks every few seconds in case the browser never fires `online`, and backs the button.
const RECONNECT_SCRIPT = `(function () {
  var done = false;
  function reload() { if (!done) { done = true; location.reload(); } }
  function check() {
    fetch(location.href, { method: "HEAD", cache: "no-store" }).then(function (r) { if (r.ok || r.status < 500) reload(); }, function () {});
  }
  window.addEventListener("online", reload);
  setInterval(check, 4000);
  var b = document.getElementById("offline-retry");
  if (b) b.addEventListener("click", reload);
})();`;

export default function OfflinePage() {
  return (
    <main className="stax" data-theme="soft" data-mode="dark">
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 28,
          textAlign: "center",
          background: "var(--surface-2)",
          color: "var(--ink)",
        }}
      >
        <div
          style={{
            maxWidth: 380,
            padding: "26px 24px",
            borderRadius: "var(--rr-lg, 22px)",
            background: "var(--glass)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "var(--glass-blur)",
            border: "1px solid var(--glass-stroke)",
            boxShadow: "var(--glass-hi), var(--glass-shadow)",
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>You&apos;re offline</h1>
          <p style={{ marginTop: 10, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
            Stax needs a connection to load your portfolio. It reloads on its own as soon as you&apos;re back.
          </p>
          <button
            id="offline-retry"
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 18, minHeight: 46, fontSize: 15.5 }}
          >
            Try again
          </button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: RECONNECT_SCRIPT }} />
    </main>
  );
}
