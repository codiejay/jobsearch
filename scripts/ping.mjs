// Phone pings through ntfy.sh. Only the scan pings, when it drafts a role
// worth your time. The topic lives in data/notify.json. The topic name is
// the only secret, so it's random and created on first use.
//
//   node scripts/ping.mjs --test   send one test message
//
// Only the title, company, location, fit and the one-line verdict reason
// leave this machine. Never the CV, letters or gaps.

import crypto from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../jobsearch.config.mjs";

const FILE = path.join(process.cwd(), "data/notify.json");

export function settings() {
  const base = { server: config.ntfy.server, quiet: config.ntfy.quiet };
  try {
    return { ...base, ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const s = { topic: "js-" + crypto.randomBytes(12).toString("hex") };
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(s, null, 1) + "\n", { mode: 0o600 });
    console.log(`created ${path.relative(process.cwd(), FILE)}: subscribe to topic ${s.topic} in the ntfy app`);
    return { ...base, ...s };
  }
}

function quiet([from, to], h = new Date().getHours()) {
  return from > to ? h >= from || h < to : h >= from && h < to;
}

const plain = (s) => String(s ?? "").replace(/\s*[–—]\s*/g, ", ").trim();
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// The board the phone opens: BOARD_URL if the board is hosted somewhere,
// else nothing (localhost is no use from a phone).
function boardAction() {
  const url = process.env.BOARD_URL;
  return url ? [{ action: "view", label: "Open board", url }] : [];
}

export function rolePing(j) {
  const send = j.brief.verdict === "send";
  const where = j.mode === "remote" ? "Remote" : plain(j.location) || "On-site";
  return {
    title: cap(`${send ? "Ready to apply" : "Write yourself"}: ${plain(j.title)}`, 80),
    message: `${plain(j.company)}, ${where}. Fit ${j.brief.fit}.\n${plain(j.brief.verdictWhy)}`,
    click: j.url,
    priority: send ? 4 : 3,
    tags: ["briefcase"],
    actions: boardAction(),
  };
}

// The pings for one scan: up to 3 roles by fit, then one line for the rest.
export function runPings(roles) {
  const top = [...roles].sort((a, b) => (b.brief.fit ?? 0) - (a.brief.fit ?? 0));
  const out = top.slice(0, 3).map(rolePing);
  const more = top.length - 3;
  if (more > 0) out.push({ title: "Job search", message: `${more} more ready on the board.`, priority: 3, tags: ["briefcase"], actions: boardAction() });
  return out;
}

// Sends one message. Never throws: a failed ping must not stop the scan.
export async function ping({ title, message, click, priority = 3, tags, actions }) {
  try {
    const s = settings();
    if (quiet(s.quiet)) priority = 2;
    const body = { topic: s.topic, title, message, priority };
    if (click) body.click = click;
    if (tags?.length) body.tags = tags;
    if (actions?.length) body.actions = actions;
    const res = await fetch(s.server.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10e3),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`pinged: ${title}`);
    return true;
  } catch (e) {
    console.warn(`ping failed: ${title}: ${e.message}`);
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--test")) {
  const { loadEnv } = await import("./env.mjs");
  loadEnv();
  await ping({ title: "Job search", message: "Test ping. If you see this, pings work.", tags: ["briefcase"], actions: boardAction() });
}
