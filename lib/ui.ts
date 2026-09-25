import { useEffect, useState } from "react";

/* Types and small pure helpers shared by the board's components. */

export type Job = {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: number;
  region: string;
  mode?: "remote" | "on-site";
  apply?: "company" | "easy" | "unknown";
  lang?: boolean;
  // remote, in Portugal, or offers sponsorship (set by the scan)
  takeable?: boolean;
  // sent in from the browser extension
  manual?: boolean;
  seniority?: string;
  score: number;
  status: Status;
  statusAt?: number;
  // the first time it was marked applied (or sent from the board)
  appliedAt?: number;
  // from Claude's brief, when one has been written
  verdict?: "send" | "you" | "skip";
  fit?: number;
};

export type Brief = {
  verdict: "send" | "you" | "skip";
  verdictWhy: string;
  fit: number;
  summary: string;
  wants: string[];
  matches: string[];
  gaps: string[];
  flags: string[];
  apply: { method: "email" | "form" | "unknown"; email: string };
  subject: string;
  letter: string;
  cost?: number;
};

// Claude's fit once a brief exists, the rule score before that. The rule
// score only orders the list; the page never shows it as a number, since
// it says how fresh and takeable a role is, not how well you fit it.
export const heat = (j: Job) => j.fit ?? j.score;

export type Status = "new" | "drafted" | "applied" | "interview" | "offer" | "rejected" | "skipped";

// The pipeline after "new". Order is the order a role moves through.
export const STAGES: { key: Status; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
];
// The line after the stage, once an application is out.
export const AFTER = {
  applied: "Waiting to hear back. Move it along when they reply.",
  interview: "The brief below is your prep: what they want and where you're thin.",
  offer: "They made an offer.",
  rejected: "Closed.",
};

export const LABEL: Record<Status, string> = {
  new: "",
  drafted: "",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  skipped: "Skipped",
};

// Tabs over the table, in the order you work through them. Each has one
// plain line under the heading saying what the list is and what to do.
export const untouched = (j: Job) => j.status === "new" || j.status === "drafted";
export const VIEWS: { key: string; label: string; line: string; test: (j: Job) => boolean }[] = [
  {
    key: "send",
    label: "Ready to apply",
    line: "The letter is written. Read it, then apply.",
    test: (j) => j.verdict === "send" && untouched(j),
  },
  {
    key: "you",
    label: "Write yourself",
    line: "Worth your own words. Each brief says why.",
    test: (j) => j.verdict === "you" && untouched(j),
  },
  {
    key: "sent",
    label: "Applied",
    line: "Roles you applied to. Move each one along as you hear back.",
    test: (j) => ["applied", "interview", "offer", "rejected"].includes(j.status),
  },
  {
    key: "all",
    label: "All",
    line: "Every match from the last two weeks, best first.",
    test: (j) => j.status !== "skipped",
  },
  { key: "skipped", label: "Skipped", line: "Roles you passed on.", test: (j) => j.status === "skipped" },
];

// What the Status column says. Before you act, it's the draft's verdict;
// after, it's where the application stands.
export function stage(j: Job): { key: string; label: string } {
  if (untouched(j)) {
    if (j.verdict === "send") return { key: "send", label: "Ready to apply" };
    if (j.verdict === "you") return { key: "you", label: "Write yourself" };
    if (j.verdict === "skip") return { key: "skip", label: "Skip suggested" };
    return { key: "new", label: "Not drafted" };
  }
  return { key: j.status, label: LABEL[j.status] };
}

// Score reads by brightness, no coloured dots: 80+ bright, 65+ normal, rest dim.
export const band = (n: number) => (n >= 80 ? "hi" : n >= 65 ? "mid" : "lo");

// "ALBERT" -> "Albert". Shouting names come from HN posts.
export function calm(s: string) {
  return s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s)
    ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : s;
}

export const REGION_NAME: Record<string, string> = { EU: "EU", PT: "Portugal", WW: "worldwide", UK: "UK" };

// "Lisbon, Lisbon, Portugal" -> "Lisbon, Portugal"
export function place(l: string) {
  const parts = l.split(",").map((p) => p.trim()).filter(Boolean);
  const out = parts.filter((p, i) => parts.indexOf(p) === i);
  const s = out.length > 2 ? [out[0], out[out.length - 1]].join(", ") : out.join(", ");
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
}

export const OUT: Status[] = ["applied", "interview", "offer", "rejected"];
export function appliedAt(j: Job): number | undefined {
  if (!OUT.includes(j.status)) return undefined;
  return j.appliedAt ?? (j.status === "applied" ? j.statusAt : undefined);
}

// "today", "yesterday", "Thu 25 Sep", with " at 14:32" when withTime.
// Local time, so the table only renders it after mount: the server's
// clock is in another time zone.
export function day(t: number, withTime = false) {
  const d = new Date(t);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const date =
    t >= start.getTime()
      ? "today"
      : t >= start.getTime() - 864e5
      ? "yesterday"
      : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  if (!withTime) return date;
  return `${date} at ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// Short enough for the phone's meta line: "21:51" today, "yesterday
// 21:51", "25 Sep 21:51" before that.
export function stamp(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (t >= start.getTime()) return time;
  if (t >= start.getTime() - 864e5) return `yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function ago(t: number, now: number) {
  const m = Math.max(0, Math.round((now - t) / 6e4));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export type Detail = {
  desc: string;
  seniority?: string;
  empType?: string;
  brief: Brief | null;
  // what the extension last filled into this role's application form
  form?: { url: string; filledAt: number; answers: { label: string; value: string; kind: string }[] } | null;
  // the email as it went out, when the letter was sent from the board
  sentMail?: { to: string; subject: string; body: string; at: number; messageId: string } | null;
};

export type Person = { name: string; firstName: string };
