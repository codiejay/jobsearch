// The scan. Pulls fresh roles, scores them with score.mjs, merges them
// into the board through lib/store.ts, looks up LinkedIn postings for
// their descriptions, then drafts a brief and letter for the best ones
// through lib/brief.ts. Feeds:
//   LinkedIn           public guest search, no login. Queries and places
//                      come from jobsearch.config.mjs.
//   HN                 the monthly "Who is hiring" thread.
//   Remotive           remote software jobs API.
//   We Work Remotely   front-end and full-stack RSS feeds.
//   Working Nomads     public jobs JSON, development roles only.
//   Jobgether, Jobicy, Arbeitnow, Himalayas, Landing.jobs and the company
//   boards you name: see scripts/feeds.mjs. Any feed can be turned off in
//   jobsearch.config.mjs.
//
// What gets in is strict on purpose (scripts/intake.mjs): a new role must
// score, must be takeable from where you are, and only the newMax best
// new roles of a scan make the board.
//
//   jobsearch scan               since the last scan (1 to 24 hours)
//   jobsearch scan --hours 24    the last day
//   jobsearch scan --no-draft    no Claude calls
//   jobsearch scan --test-alert  try the "screen or phone" choice
//
// Meant to run every hour: see launchd/ and `jobsearch schedule`.

import "./ts-hooks.mjs";
import { fileURLToPath } from "node:url";
import { ping, runPings } from "./ping.mjs";
import { loadEnv } from "./env.mjs";
import { score, region, FE, PRODUCT, DESIGN, OTHER_FE } from "./score.mjs";
import { get, decode, plain, UA } from "./http.mjs";
import { intake } from "./intake.mjs";
import * as feeds from "./feeds.mjs";
import config from "../jobsearch.config.mjs";

// The store is TypeScript, so it loads through ts-hooks.mjs by dynamic
// import, after the hooks are registered. Set in main().
let store;
const hoursArg = process.argv.indexOf("--hours");
// Without --hours, look back to the last scan (at least 1 hour, at most
// a day), so a machine that slept through a few runs doesn't miss roles.
async function sinceLastScan() {
  try {
    const at = (await store.getMeta()).scannedAt;
    if (!at) return 24;
    return Math.min(24, Math.max(1, Math.ceil((Date.now() - at) / 36e5)));
  } catch {
    return 24;
  }
}
let HOURS = 24; // set in main()

const LI_QUERIES = config.linkedin.queries;
// Remote searches run first and the loop stops at LI_BUDGET, so the last
// geo in the config is the one that gets cut on a slow day. A geo with no
// region reads each card's own location and keeps only target regions.
const LI_GEOS = config.linkedin.geos;
const TARGETS = Object.keys(config.regions.remote).filter((r) => r !== "?");

// Hard budget for one run, so an hourly job can never pile up.
const T0 = Date.now();
// Hard stop, so a hung request can never leave a scan running into the next.
setTimeout(() => {
  console.error("scan killed after 9 minutes");
  process.exit(1);
}, 9 * 60e3).unref();
// LinkedIn gets 150s: geos x queries x two pages at about 2.5s each.
const LI_BUDGET = 150e3;
const RUN_BUDGET = 220e3;
const DRAFT_MIN = config.draftMin;
const KEEP_MIN = config.keepMin;
const DRAFT_MAX = config.draftMax;
const DRAFT_BUDGET = config.draftSeconds * 1e3;
const NO_DRAFT = process.argv.includes("--no-draft");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "12 minutes ago" -> ms ago
function agoMs(text) {
  const m = /(\d+)\s+(second|minute|hour|day|week|month)/.exec(text || "");
  if (!m) return null;
  const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 };
  return Number(m[1]) * unit[m[2]];
}

export async function linkedin() {
  const jobs = [];
  for (const g of LI_GEOS) {
    for (const q of LI_QUERIES) {
      // The guest search returns 10 cards a page.
      for (const start of [0, 10]) {
        if (Date.now() - T0 > LI_BUDGET) {
          console.warn("linkedin: out of time, stopping early");
          return jobs;
        }
        const url =
          "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?" +
          new URLSearchParams({
            keywords: q,
            location: g.location,
            geoId: g.geoId,
            f_WT: g.wt,
            f_TPR: `r${Math.round(HOURS * 3600)}`,
            sortBy: "DD",
            start: String(start),
          });
        let html;
        try {
          html = await get(url);
        } catch (e) {
          console.warn("linkedin", e.message);
          await sleep(4000);
          continue;
        }
        const cards = html.split(/<li>/).slice(1);
        for (const c of cards) {
          const id = /jobPosting:(\d+)/.exec(c)?.[1];
          if (!id) continue;
          const title = decode(/base-search-card__title">([\s\S]*?)<\/h3>/.exec(c)?.[1] || "");
          const company = decode(/base-search-card__subtitle">([\s\S]*?)<\/h4>/.exec(c)?.[1] || "");
          const location = decode(/job-search-card__location">([\s\S]*?)<\/span>/.exec(c)?.[1] || "");
          const ago = decode(/<time[^>]*>([\s\S]*?)<\/time>/.exec(c)?.[1] || "");
          const day = /datetime="([^"]+)"/.exec(c)?.[1];
          const ms = agoMs(ago);
          const postedAt = ms != null ? Date.now() - ms : day ? Date.parse(day) : Date.now();
          // Worldwide remote is mostly roles for one country: US states,
          // India, China. Keep only the ones placed in a target region.
          if (!g.region && !TARGETS.includes(region({ location }))) continue;
          jobs.push({
            id: `li:${id}`,
            source: "LinkedIn",
            title,
            company,
            location,
            url: `https://www.linkedin.com/jobs/view/${id}`,
            postedAt,
            region: g.region,
            mode: g.mode,
          });
        }
        await sleep(1500);
        if (cards.length < 10) break;
      }
    }
  }
  return jobs;
}

export async function hackernews() {
  const s = await get(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=5",
    { json: true }
  );
  const story = s.hits.find((h) => /who is hiring/i.test(h.title));
  if (!story) return [];
  const item = await get(`https://hn.algolia.com/api/v1/items/${story.objectID}`, { json: true });
  const jobs = [];
  for (const c of item.children || []) {
    if (!c.text) continue;
    const text = c.text
      .split("<p>")
      .map((l) => decode(l))
      .filter(Boolean)
      .join("\n\n");
    // People looking for work sometimes post in the hiring thread too.
    if (/seeking work|looking for (work|a job)|willing to relocate:|r[ée]sum[ée]\/cv:/i.test(text.slice(0, 400))) continue;
    const head = text.split("\n")[0].slice(0, 300);
    const parts = head.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const rolePart =
      parts.find((p) => /front|react|product engineer|ui engineer|web engineer|full[- ]?stack/i.test(p)) ||
      parts.find((p) => /engineer|developer/i.test(p));
    if (!rolePart) continue;
    // HN heads are free text. Pull out just the job title when it's buried
    // in a sentence ("Hiring: exceptional consumer product engineers at...").
    const m = /((senior|sr\.?|lead|staff|founding|mid[- ]level)\s+)?(front[- ]?end|frontend|product|full[- ]?stack|react|ui|web|software|design)\s+(engineer|developer)s?/i.exec(rolePart);
    const role = rolePart.length > 50 && m ? m[0].replace(/s$/, "").replace(/^\w/, (c) => c.toUpperCase()) : rolePart;
    // The first part is usually the company; if it looks like a place or a
    // role instead, fall back to the domain of the first link.
    let company = parts[0].replace(/https?:\/\/\S+/g, "").trim();
    if (!company || /engineer|developer|remote|onsite|germany|london|usa|europe/i.test(company)) {
      const dom = /https?:\/\/(?:www\.)?([a-z0-9-]+)\./i.exec(text)?.[1];
      company = dom ? dom[0].toUpperCase() + dom.slice(1) : parts[0];
    }
    const loc = parts.filter((p) => /remote|europe|emea|eu\b|worldwide|anywhere|london|berlin|lisbon|amsterdam|paris|onsite|hybrid|usa?\b|nyc|sf\b|canada/i.test(p)).join(", ");
    jobs.push({
      id: `hn:${c.id}`,
      source: "HN",
      title: role.slice(0, 120),
      company: company.slice(0, 60),
      location: loc || "See post",
      // "ONSITE (part remote)" is on-site
      mode: /remote/i.test(head) && !/on-?site|hybrid|part[- ]remote|in[- ]office/i.test(head) ? "remote" : "on-site",
      where: head,
      url: `https://news.ycombinator.com/item?id=${c.id}`,
      postedAt: Date.parse(c.created_at),
      blurb: text.slice(0, 4000),
    });
  }
  return jobs;
}

export async function remotive() {
  const jobs = [];
  for (const search of ["frontend", "react", "product engineer"]) {
    try {
      const d = await get(
        `https://remotive.com/api/remote-jobs?category=software-dev&search=${encodeURIComponent(search)}&limit=100`,
        { json: true }
      );
      for (const j of d.jobs || [])
        jobs.push({
          id: `rv:${j.id}`,
          source: "Remotive",
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || "Remote",
          url: j.url,
          postedAt: Date.parse(j.publication_date),
          mode: "remote",
          salary: j.salary || undefined,
        });
    } catch (e) {
      console.warn("remotive", e.message);
    }
  }
  return jobs;
}

export async function weworkremotely() {
  const jobs = [];
  for (const cat of ["remote-front-end-programming-jobs", "remote-full-stack-programming-jobs"]) {
    let xml;
    try {
      xml = await get(`https://weworkremotely.com/categories/${cat}.rss`);
    } catch (e) {
      console.warn("weworkremotely", e.message);
      continue;
    }
    for (const it of xml.split("<item>").slice(1)) {
      const tag = (t) => {
        const v = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(it)?.[1] || "";
        return /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(v)?.[1] ?? v;
      };
      const link = tag("link").trim();
      if (!link) continue;
      // "Company: Role"
      const head = decode(tag("title"));
      const i = head.indexOf(": ");
      // The description is escaped HTML, so unescape it once before plain().
      const html = tag("description")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
      const where = decode(tag("region")) || decode(tag("country"));
      jobs.push({
        id: `wwr:${link.split("/").pop()}`,
        source: "We Work Remotely",
        title: i > 0 ? head.slice(i + 2) : head,
        company: i > 0 ? head.slice(0, i) : "",
        location: where || "Remote",
        url: link,
        postedAt: Date.parse(tag("pubDate")) || Date.now(),
        mode: "remote",
        desc: plain(html),
      });
    }
  }
  return jobs;
}

export async function workingnomads() {
  const d = await get("https://www.workingnomads.com/api/exposed_jobs/", { json: true });
  const jobs = [];
  for (const j of d || []) {
    if (j.category_name !== "Development" || !j.url) continue;
    const id = /\/(\d+)\/?$/.exec(j.url)?.[1] || j.url;
    // Some titles repeat the company: "Beekman Social - Account Manager".
    const pre = `${j.company_name} - `;
    const title = decode(j.title.startsWith(pre) ? j.title.slice(pre.length) : j.title);
    jobs.push({
      id: `wn:${id}`,
      source: "Working Nomads",
      title,
      company: j.company_name,
      location: j.location || "Remote",
      url: j.url,
      postedAt: Date.parse(j.pub_date) || Date.now(),
      mode: "remote",
      desc: plain(j.description || ""),
    });
  }
  return jobs;
}

// LinkedIn's public posting page says whether "Apply" goes to the
// company's site or is Easy Apply. Easy Apply roles get flagged and
// pushed down: the letter and the form fill have nowhere to go. The description also tells us if the job
// wants German, French and so on. The reader lives in lib so the brief
// route can use it too.
async function enrich(j) {
  const { lookupPosting } = await import("../lib/linkedin.ts");
  return lookupPosting(j.id);
}

async function main() {
  const t0 = T0;
  loadEnv();
  store = await import("../lib/store.ts");
  console.log(`storage: ${store.backend()}`);
  // --test-alert: no search, no drafts. Runs the real "Mac or phone?"
  // choice on the best role ready to apply, so the lock and away checks
  // can be tried by hand. It may send one real ping.
  if (process.argv.includes("--test-alert")) {
    const best = (await store.listJobs())
      .filter((j) => j.brief?.verdict === "send" && j.status === "drafted")
      .sort((a, b) => b.brief.fit - a.brief.fit)[0];
    if (best) await alert([best]);
    return;
  }
  HOURS = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : await sinceLastScan();
  // The feeds that filter by date get an hour of slack, for a machine that
  // slept through a run and for boards that post on a delay.
  const since = Date.now() - (HOURS + 1) * 36e5;
  const on = (k) => config.feeds?.[k] !== false;
  const runs = [
    ["LinkedIn", "linkedin", () => linkedin()],
    ["HN", "hn", () => hackernews()],
    ["Remotive", "remotive", () => remotive()],
    ["We Work Remotely", "weworkremotely", () => weworkremotely()],
    ["Working Nomads", "workingnomads", () => workingnomads()],
    ["Jobgether", "jobgether", () => feeds.jobgether(since)],
    ["Jobicy", "jobicy", () => feeds.jobicy(since)],
    ["Arbeitnow", "arbeitnow", () => feeds.arbeitnow(since)],
    ["Himalayas", "himalayas", () => feeds.himalayas(since)],
    ["Landing.jobs", "landingjobs", () => feeds.landingjobs(since)],
    ["Company boards", "companies", () => feeds.companies(config.companies, since)],
  ].filter(([, k]) => on(k));
  const results = await Promise.allSettled(runs.map(([, , run]) => run()));
  const found = [];
  results.forEach((r, i) => {
    const name = runs[i][0];
    if (r.status === "fulfilled") {
      console.log(`${name}: ${r.value.length} raw`);
      found.push(...r.value);
    } else console.warn(`${name} failed: ${r.reason?.message}`);
  });
  console.log(`fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let prev = { jobs: [] };
  try {
    prev = { jobs: await store.listJobs() };
  } catch {}
  const byId = new Map(prev.jobs.map((j) => [j.id, j]));

  let added = 0;
  // "Air Apps, Inc.|Front-End Engineer" and "air apps|frontend engineer"
  // are one role, whether the scan found it or it was sent in by hand.
  const n = (s = "") => s.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|bv|sa|ag)\b|front[- ]end|[^a-z0-9]/g, (m) => (/front/.test(m) ? "frontend" : ""));
  const roleKey = (j) => `${n(j.company)}|${n(j.title)}`;
  const picked = intake(found, byId, roleKey, { takeableOnly: config.takeableOnly, newMax: config.newMax, keepMin: KEEP_MIN });
  for (const { job: j, s, old } of [...picked.update, ...picked.add]) {
    // Start from what's saved, so the brief, the looked-up description and
    // the apply method survive when a feed returns the same role again.
    byId.set(j.id, {
      ...old,
      ...j,
      ...s,
      status: old?.status || "new",
      firstSeen: old?.firstSeen || Date.now(),
    });
    if (!old) added++;
  }
  if (picked.skipped) console.log(`${picked.skipped} more scored but were under the ${config.newMax ?? 30} best new roles, left out`);

  // Keep two weeks, but never drop something acted on. HN threads are
  // monthly, so they get longer.
  const keep = (j) => (j.source === "HN" ? config.keepDaysHn : config.keepDays) * 864e5;
  async function save() {
    // The page and the extension write to the board too, and a scan takes
    // minutes. Take their changes first: roles added by hand, statuses set
    // and briefs written since this scan read it.
    const stored = new Map(); // id -> the role as saved, to tell what changed
    try {
      for (const f of await store.listJobs()) {
        stored.set(f.id, JSON.stringify(f));
        const j = byId.get(f.id);
        if (!j) byId.set(f.id, f);
        else
          Object.assign(j, {
            status: f.status,
            statusAt: f.statusAt,
            appliedAt: f.appliedAt,
            sentMail: f.sentMail ?? j.sentMail,
            brief: f.brief ?? j.brief,
          });
      }
    } catch {}
    const jobs = [...byId.values()]
      .filter((j) => j.manual || Date.now() - j.postedAt < keep(j) || j.status !== "new")
      // Roles sent in by hand keep the score Claude gave them.
      .map((j) => {
        if (j.manual) return j;
        const s = score(j) || { score: 0, best: 0 };
        // best: its score the hour it was posted. Freshness only orders
        // the board; it never decides whether a role makes it.
        const { peak, ...rest } = j;
        return { ...rest, ...s, best: Math.max(peak ?? 0, s.best) };
      })
      // Only roles worth KEEP_MIN on what they are. Anything acted on or
      // sent in by hand stays regardless.
      .filter((j) => j.manual || j.status !== "new" || (j.score > 0 && j.best >= KEEP_MIN))
      .sort((a, b) => b.score - a.score || b.postedAt - a.postedAt);
    const kept = new Set(jobs.map((j) => j.id));
    await store.saveScan({
      scannedAt: Date.now(),
      jobs,
      changed: jobs.filter((j) => stored.get(j.id) !== JSON.stringify(j)),
      dropped: [...stored.keys()].filter((id) => !kept.has(id)),
    });
    return jobs.length;
  }
  await save(); // save the new roles before the slow part

  // Look up the posting page for LinkedIn roles worth a look. Capped and
  // spaced out so LinkedIn doesn't rate-limit the guest endpoint.
  let looked = 0;
  for (const j of byId.values()) {
    if (Date.now() - t0 > RUN_BUDGET - 25e3 || looked >= 30) break;
    if (j.source !== "LinkedIn" || j.looked) continue;
    if ((score(j)?.score ?? 0) < 55) continue;
    try {
      Object.assign(j, await enrich(j), { looked: Date.now() });
      looked++;
    } catch (e) {
      console.warn("enrich", e.message);
      if (/429/.test(e.message)) break;
    }
    await sleep(1500);
  }
  console.log(`looked up ${looked} LinkedIn postings`);

  // Jobgether's list has no description. Read the offer page for the
  // roles worth a brief, a few per scan, so they can be drafted.
  let read = 0;
  for (const j of byId.values()) {
    if (Date.now() - t0 > RUN_BUDGET - 15e3 || read >= 10) break;
    if (j.source !== "Jobgether" || j.desc || j.looked) continue;
    if ((score(j)?.score ?? 0) < 55) continue;
    try {
      Object.assign(j, await feeds.lookupJobgether(j.url), { looked: Date.now() });
      read++;
    } catch (e) {
      console.warn("jobgether page", e.message);
      if (/429|403/.test(e.message)) break;
    }
    await sleep(1000);
  }
  if (read) console.log(`read ${read} Jobgether pages`);

  const kept = await save();
  console.log(`${added} new, ${kept} kept, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!NO_DRAFT) await draft(t0);

}

// ---------- drafts ----------

// Writes the brief and letter for the best untouched roles, so they wait
// under Ready to apply or Write yourself. Re-reads the role before each
// write, because the page may have changed a status meanwhile.
async function draft(t0) {
  const { usd, aiSource, aiMissing } = await import("../lib/claude.ts");
  const source = aiSource();
  if (!source) return console.warn(`drafts skipped: ${aiMissing()}`);
  const { writeBrief, loadPerson } = await import("../lib/brief.ts");
  const most = source === "api" ? DRAFT_MAX : Math.min(DRAFT_MAX, config.draftMaxLocal ?? 3);
  let person;
  try {
    person = await loadPerson(store);
  } catch (e) {
    return console.warn(`drafts skipped: ${e.message}`);
  }

  const todo = (await store.listJobs())
    .filter(
      (j) =>
        j.status === "new" &&
        !j.brief &&
        (FE.test(j.title) || PRODUCT.test(j.title) || DESIGN.test(j.title)) &&
        !OTHER_FE.test(j.title) &&
        !j.lang &&
        j.apply !== "easy" &&
        (j.desc || j.blurb) &&
        j.score >= DRAFT_MIN
    )
    .slice(0, most);

  let drafted = 0;
  let spent = 0;
  const worth = []; // roles to ping about, sent after the loop
  for (const j of todo) {
    if (Date.now() - t0 > DRAFT_BUDGET) break;
    try {
      let cost = 0;
      const brief = await writeBrief(j, j.desc || j.blurb, person, (u) => (cost = usd(u)));
      const x = await store.getJob(j.id);
      if (!x) continue;
      x.brief = { ...brief, cost };
      if (x.status === "new") {
        x.status = "drafted";
        x.statusAt = Date.now();
      }
      // Mark before sending, so a re-run or redraft never pings twice.
      if ((brief.verdict === "send" || brief.verdict === "you") && !x.pingedAt) {
        x.pingedAt = Date.now();
        worth.push({ ...x });
      }
      await store.putJob(x);
      spent += cost;
      drafted++;
      console.log(`drafted ${brief.verdict.padEnd(4)} ${brief.fit}  ${j.company}, ${j.title}`);
    } catch (e) {
      console.warn(`draft failed, ${j.company}: ${e.message}`);
    }
  }
  await alert(worth);
  console.log(`drafted ${drafted} of ${todo.length} via ${source}, $${spent.toFixed(2)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Where the news goes. At the desk (a key or the mouse in the last
// awayMinutes, screen unlocked, Chrome's extension checked in in the last
// 3 minutes, not sharing the screen, not muted), the extension shows it
// on screen and the phone stays quiet. Otherwise the phone gets the ping.
// A notice not opened within 45 minutes goes to the phone too, in case
// the person walked away just after it arrived. Only when they are away:
// at the desk it is still on screen. Off a Mac the desk checks always say
// away, so everything goes to the phone.
const AWAY_S = config.awayMinutes * 60;
const STALE_DESK = 45 * 6e4;
async function alert(worth) {
  const store = await import("../lib/store.ts");
  const desk = await import("../lib/desk.ts");
  const p = await store.getPresence();
  const idle = await desk.idleSeconds();
  const here =
    idle < AWAY_S &&
    !(await desk.screenLocked()) &&
    p && Date.now() - p.at < 3 * 6e4 &&
    !p.sharing &&
    !(p.holdUntil > Date.now()) &&
    !(await desk.appSharing());

  const stale = (await store.listJobs()).filter(
    (j) => j.deskAt && !j.deskSeenAt && !j.phonedAt && Date.now() - j.deskAt > STALE_DESK && (j.status === "drafted" || j.status === "new")
  );
  const phone = here ? [] : [...worth, ...stale];
  const onDesk = here ? worth : [];

  for (const j of onDesk) {
    const x = await store.getJob(j.id);
    if (x) await store.putJob({ ...x, deskAt: Date.now() });
  }
  for (const j of phone) {
    const x = await store.getJob(j.id);
    if (x) await store.putJob({ ...x, phonedAt: Date.now() });
  }
  const why = `idle ${Math.round(idle)}s, locked ${await desk.screenLocked()}, extension ${p ? Math.round((Date.now() - p.at) / 1000) + "s ago" : "never"}, sharing ${!!p?.sharing}, muted ${p?.holdUntil > Date.now()}`;
  if (worth.length || stale.length)
    console.log(`${here ? "at the desk" : "away"} (${why}): ${onDesk.length} on screen, ${phone.length} to the phone, ${stale.length} unseen over 45 min`);
  for (const m of runPings(phone)) await ping(m);
}

// Only run when called as a script; the tests and one-off checks import
// the feed functions without starting a scan.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
