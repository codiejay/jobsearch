import { useState } from "react";

/* Shown when the board needs a password. Posts it to /api/signin, which
   sets the session cookie the board checks, then reloads into the board. */
export default function SignIn() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (r?.ok) return location.reload();
    setBusy(false);
    setError(r?.status === 401 ? "Wrong password." : "Couldn't sign in. Try again.");
  }

  return (
    <div className="js">
      <main className="signin">
        <form className="panel" onSubmit={submit}>
          <h1>Job search</h1>
          <label htmlFor="pw">Board password</label>
          <input
            id="pw"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="err" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !password}>
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      </main>
      <style jsx>{`
        .signin {
          max-width: 340px;
          margin: 0 auto;
          padding: 96px 16px 64px;
        }
        .signin form {
          display: grid;
          gap: 8px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 18px 20px 20px;
        }
        .signin h1 {
          margin: 0 0 8px;
          font-size: 14px;
          font-weight: 500;
        }
        .signin label {
          color: var(--faint);
          font-size: 11px;
        }
        .signin input {
          font: inherit;
          font-size: 16px;
          color: var(--text);
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 8px 10px;
          outline: none;
        }
        .signin input:focus {
          border-color: var(--muted);
        }
        .signin .err {
          margin: 0;
          color: var(--amber);
          font-size: 12.5px;
        }
        .signin button {
          margin-top: 6px;
          font: inherit;
          font-weight: 500;
          color: var(--bg);
          background: var(--text);
          border: 0;
          border-radius: 8px;
          padding: 8px 12px;
          cursor: pointer;
        }
        .signin button:disabled {
          opacity: 0.5;
          cursor: default;
        }
      `}</style>
    </div>
  );
}
