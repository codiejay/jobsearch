import fs from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";

/* The one place that reads and writes the board: the page, the API
   routes, the extension's routes and the scan all come through here.

   With JOBSEARCH_STORE=redis and Upstash keys set it uses Redis, so this
   machine and a hosted copy share one board. Otherwise it uses the files
   in data/. Hosted without Redis it throws: a serverless disk is thrown
   away, so writing there would lose data quietly.

   Redis keys, all under "js:":
     js:jobs     hash, field = role id, value = the role as JSON
     js:meta     hash, scannedAt
     js:presence string, what the extension last said (see Presence)
   One field per role, so two writers only clash on the same role. The
   CV, profile and voice are files on the machine that runs the scan and
   the drafts, and are never stored in Redis. */

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  [k: string]: any;
};
export type Meta = { scannedAt: number | null };
export type Profile = Record<string, string | number | boolean>;

export const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "board.json");
const K = { jobs: "js:jobs", meta: "js:meta", presence: "js:presence" };

let client: Redis | null | undefined;
function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (process.env.JOBSEARCH_STORE === "redis" && url && token) client = new Redis({ url, token, automaticDeserialization: false });
  else if (process.env.VERCEL || process.env.JOBSEARCH_HOSTED) throw new Error("Hosted without Redis. Set JOBSEARCH_STORE=redis and the Upstash keys.");
  else client = null;
  return client;
}

export function backend(): "redis" | "file" {
  return redis() ? "redis" : "file";
}

// ---------- file backend ----------

async function readFile(): Promise<{ scannedAt: number | null; jobs: Job[] }> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { scannedAt: null, jobs: [] };
    throw e;
  }
}
async function writeFile(data: { scannedAt: number | null; jobs: Job[] }) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 1));
}

// ---------- the person's files, always on disk ----------

async function dataFile(name: string, hint: string): Promise<string> {
  const text = await fs.readFile(path.join(DIR, name), "utf8").catch(() => null);
  if (!text?.trim()) throw new Error(`data/${name} is missing. ${hint}`);
  return text;
}

export const getCv = () => dataFile("cv.txt", "Paste your CV as plain text, or run: jobsearch init");
export const getVoice = () => dataFile("voice.md", "Copy data/examples/voice.md and make it yours, or run: jobsearch init");
export async function getProfile(): Promise<Profile> {
  return JSON.parse(await dataFile("profile.json", "Copy data/examples/profile.json and fill it in, or run: jobsearch init"));
}

// ---------- reads ----------

// Redis has no order, so it comes back the way the scan sorts: best
// score first, then newest.
export async function listJobs(): Promise<Job[]> {
  const r = redis();
  if (!r) return (await readFile()).jobs;
  const raw = ((await r.hgetall(K.jobs)) || []) as unknown as string[] | Record<string, string>;
  const values = Array.isArray(raw) ? raw.filter((_, i) => i % 2 === 1) : Object.values(raw);
  return values
    .map((v) => JSON.parse(v) as Job)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.postedAt ?? 0) - (a.postedAt ?? 0));
}

export async function getJob(id: string): Promise<Job | null> {
  const r = redis();
  if (!r) return (await readFile()).jobs.find((j) => j.id === id) || null;
  const v = await r.hget<string>(K.jobs, id);
  return v ? JSON.parse(v) : null;
}

export async function getMeta(): Promise<Meta> {
  const r = redis();
  if (!r) return { scannedAt: (await readFile()).scannedAt ?? null };
  const v = await r.hget<string>(K.meta, "scannedAt");
  return { scannedAt: v ? Number(v) : null };
}

// ---------- writes ----------

export async function putJob(job: Job) {
  await putJobs([job]);
}

// Replaces each role by id. In the file a new role goes to the top.
export async function putJobs(jobs: Job[]) {
  if (!jobs.length) return;
  const r = redis();
  if (r) {
    for (let i = 0; i < jobs.length; i += 20)
      await r.hset(K.jobs, Object.fromEntries(jobs.slice(i, i + 20).map((j) => [j.id, JSON.stringify(j)])));
    return;
  }
  const data = await readFile();
  const at = new Map(data.jobs.map((j, i) => [j.id, i]));
  const added: Job[] = [];
  for (const j of jobs) {
    const i = at.get(j.id);
    if (i === undefined) added.push(j);
    else data.jobs[i] = j;
  }
  data.jobs.unshift(...added);
  await writeFile(data);
}

export async function deleteJobs(ids: string[]) {
  if (!ids.length) return;
  const r = redis();
  if (r) {
    await r.hdel(K.jobs, ...ids);
    return;
  }
  const drop = new Set(ids);
  const data = await readFile();
  data.jobs = data.jobs.filter((j) => !drop.has(j.id));
  await writeFile(data);
}

export async function setMeta(meta: Meta) {
  const r = redis();
  if (r) {
    await r.hset(K.meta, { scannedAt: String(meta.scannedAt ?? "") });
    return;
  }
  await writeFile({ ...(await readFile()), scannedAt: meta.scannedAt });
}

/* The scan's save. The file is rewritten whole, sorted. Redis only gets
   the roles that changed since the scan read them, and loses the ones the
   scan dropped, so a role another writer touched meanwhile is left alone. */
export async function saveScan(s: { scannedAt: number; jobs: Job[]; changed: Job[]; dropped: string[] }) {
  if (!redis()) return writeFile({ scannedAt: s.scannedAt, jobs: s.jobs });
  await putJobs(s.changed);
  await deleteJobs(s.dropped);
  await setMeta({ scannedAt: s.scannedAt });
}

export async function countJobs(): Promise<number> {
  const r = redis();
  if (!r) return (await readFile()).jobs.length;
  return r.hlen(K.jobs);
}

/* What the extension last told the board, about once a minute while
   Chrome is open: when, whether a tab is sharing the screen, and until
   when alerts are muted. The scan reads it to choose between a notice on
   screen and a ping to the phone. */
export type Presence = { at: number; sharing: boolean; holdUntil: number };

export async function getPresence(): Promise<Presence | null> {
  const r = redis();
  const raw = r ? await r.get<string>(K.presence) : await fs.readFile(path.join(DIR, "presence.json"), "utf8").catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

export async function setPresence(p: Presence) {
  const r = redis();
  if (r) await r.set(K.presence, JSON.stringify(p));
  else {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, "presence.json"), JSON.stringify(p));
  }
}
