import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";

/* Who may use the board and its API.

   No BOARD_PASSWORD set: only requests from this machine (localhost) get
   in. That is the normal way to run it.
   BOARD_PASSWORD set: the page needs the session cookie the sign-in sets,
   and the extension sends BOARD_KEY in the x-jobsearch-key header. Set
   both when the board is reachable from outside this machine. */

export const SESSION_COOKIE = "jobsearch_session";

// Derived from the password by HMAC, so the cookie never holds it and
// changing the password signs everyone out.
export function sessionToken(): string | null {
  const pw = process.env.BOARD_PASSWORD;
  return pw ? crypto.createHmac("sha256", pw).update("jobsearch-session-v1").digest("hex") : null;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function passwordOk(given: string): boolean {
  const pw = process.env.BOARD_PASSWORD;
  return !!pw && safeEqual(given, pw);
}

export function hasSession(req: IncomingMessage): boolean {
  const want = sessionToken();
  const got = cookie(req, SESSION_COOKIE);
  return !!want && !!got && safeEqual(got, want);
}

export function isLocal(req: IncomingMessage): boolean {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function allowed(req: IncomingMessage): boolean {
  if (!process.env.BOARD_PASSWORD) return isLocal(req);
  if (hasSession(req)) return true;
  const want = process.env.BOARD_KEY;
  const got = req.headers["x-jobsearch-key"];
  return !!want && typeof got === "string" && safeEqual(got, want);
}

// For the API routes: answers 401 and returns false when not allowed.
export function authed(req: NextApiRequest, res: NextApiResponse): boolean {
  if (allowed(req)) return true;
  res.status(401).json({
    error: process.env.BOARD_PASSWORD ? "Sign in first." : "The board only answers on localhost. Set BOARD_PASSWORD to open it up.",
  });
  return false;
}
