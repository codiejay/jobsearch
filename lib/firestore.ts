import { createSign } from "node:crypto";

/* Firestore over plain REST, shaped like the few Upstash calls the store
   makes (get, set, hget, hgetall, hset, hdel, hlen), so lib/store.ts uses
   either one the same way. Chosen with JOBSEARCH_STORE=firestore.

   Why: the free Upstash plan stops answering for the rest of the month
   once 10 GB has been read (5 Oct 2026, down until 1 Nov). Firestore
   bills per read instead, a few cents a month here, and never locks.

   FIRESTORE_KEY is a service account's JSON key, base64. FIRESTORE_DB is
   the database name, "(default)" when unset. A token is minted from the
   key (a signed JWT) and reused for most of an hour.

   Layout: a Redis hash "js:jobs" is the collection "js-jobs", one
   document per field, the value in "v". A plain key "js:cv" is the
   document "js-kv/js-cv". Role ids can hold "/" (Himalayas ids are URLs),
   which a document id can't, so ids are stored URI-encoded. */

type Key = { client_email: string; private_key: string; project_id: string };
type Doc = { name: string; fields?: { v?: { stringValue?: string } } };

let key: Key | null | undefined;
function creds(): Key | null {
  if (key !== undefined) return key;
  try {
    key = JSON.parse(Buffer.from(process.env.FIRESTORE_KEY || "", "base64").toString("utf8")) as Key;
    if (!key.client_email || !key.private_key) key = null;
  } catch {
    key = null;
  }
  return key;
}

export const firestoreConfigured = () => !!creds();

let tok: { value: string; exp: number } | null = null;
async function token(): Promise<string> {
  const k = creds();
  if (!k) throw new Error("FIRESTORE_KEY is missing or not a base64 service account key.");
  const now = Math.floor(Date.now() / 1000);
  if (tok && tok.exp - 300 > now) return tok.value;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: k.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(k.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !j.access_token) throw new Error(`firestore token ${res.status}`);
  tok = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return tok.value;
}

const root = () => `projects/${creds()!.project_id}/databases/${process.env.FIRESTORE_DB || "(default)"}`;
const coll = (k: string) => k.replace(/:/g, "-");
const name = (c: string, id: string) => `${root()}/documents/${c}/${encodeURIComponent(id)}`;
const KV = "js-kv";

async function call(path: string, body?: object): Promise<any> {
  const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`firestore ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Firestore takes up to 500 writes in one commit, all or none.
async function commit(writes: object[]) {
  for (let i = 0; i < writes.length; i += 400) await call(`${root()}/documents:commit`, { writes: writes.slice(i, i + 400) });
}

async function getOne(c: string, id: string): Promise<string | null> {
  const r = (await call(`${root()}/documents:batchGet`, { documents: [name(c, id)] })) as { found?: Doc }[];
  const v = r.find((x) => x.found)?.found?.fields?.v?.stringValue;
  return typeof v === "string" ? v : null;
}

const put = (c: string, id: string, v: string) => ({ update: { name: name(c, id), fields: { v: { stringValue: v } } } });

export const firestore = {
  async get<T = string>(k: string): Promise<T | null> {
    return (await getOne(KV, coll(k))) as T | null;
  },
  async set(k: string, v: string) {
    await commit([put(KV, coll(k), v)]);
    return "OK";
  },
  async hget<T = string>(k: string, field: string): Promise<T | null> {
    return (await getOne(coll(k), field)) as T | null;
  },
  async hgetall(k: string): Promise<Record<string, string> | null> {
    const out: Record<string, string> = {};
    let page = "";
    do {
      const q = new URLSearchParams({ pageSize: "300" });
      if (page) q.set("pageToken", page);
      const j = (await call(`${root()}/documents/${coll(k)}?${q}`)) as { documents?: Doc[]; nextPageToken?: string };
      for (const d of j.documents ?? []) {
        const v = d.fields?.v?.stringValue;
        if (typeof v === "string") out[decodeURIComponent(d.name.split("/").pop()!)] = v;
      }
      page = j.nextPageToken ?? "";
    } while (page);
    return Object.keys(out).length ? out : null;
  },
  async hset(k: string, values: Record<string, string>) {
    await commit(Object.entries(values).map(([f, v]) => put(coll(k), f, v)));
    return Object.keys(values).length;
  },
  async hdel(k: string, ...fields: string[]) {
    await commit(fields.map((f) => ({ delete: name(coll(k), f) })));
    return fields.length;
  },
  async hlen(k: string): Promise<number> {
    const r = (await call(`${root()}/documents:runAggregationQuery`, {
      structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: coll(k) }] }, aggregations: [{ alias: "n", count: {} }] },
    })) as { result?: { aggregateFields?: { n?: { integerValue?: string } } } }[];
    return Number(r[0]?.result?.aggregateFields?.n?.integerValue ?? 0);
  },
};
