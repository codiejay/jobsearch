import type { NextApiRequest, NextApiResponse } from "next";
import { SESSION_COOKIE, passwordOk, sessionToken } from "../../lib/guard";

/* Sign in with BOARD_PASSWORD. Sets the session cookie the board checks.
   DELETE clears it. */

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket as { encrypted?: boolean }).encrypted;
  const base = `${SESSION_COOKIE}=%s; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  if (req.method === "DELETE") {
    res.setHeader("set-cookie", base.replace("%s", "") + "; Max-Age=0");
    return res.json({ ok: true });
  }
  if (req.method !== "POST") return res.status(405).end();

  const { password } = (req.body || {}) as { password?: string };
  const token = sessionToken();
  if (!token) return res.status(500).json({ error: "BOARD_PASSWORD is not set." });
  if (typeof password !== "string" || !passwordOk(password)) return res.status(401).json({ error: "Wrong password." });
  res.setHeader("set-cookie", base.replace("%s", token) + `; Max-Age=${30 * 86400}`);
  return res.json({ ok: true });
}
