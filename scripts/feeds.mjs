// The feeds added in 1.2: five job boards with a public API, and the
// hiring pages of companies you name. Each feed is a fetcher that returns
// roles in the board's shape, built on a pure mapper (mapX) that
// feeds.test.mjs checks against a saved sample.
//
//   Jobgether     remote frontend roles in Europe and worldwide, by date.
//                 The list has no description; scan.mjs reads the offer
//                 page for the best ones.
//   Jobicy        remote roles tagged frontend, with the eligible countries.
//   Arbeitnow     Europe, mostly on-site in Germany, the UK and France,
//                 with a remote flag. Everything posted in the last day.
//   Himalayas     remote roles with exact location restrictions.
//   Landing.jobs  Portugal's board. Small, on-site Lisbon and Porto.
//   Companies     Ashby, Greenhouse and Lever boards from
//                 jobsearch.config.mjs, read every scan.
//
// Every fetcher takes `since` (ms): roles posted before it are dropped
// and paging stops at the first page older than it. Each is capped at a
// few requests so an hourly scan never grows with the boards.

import { get, decode, plain, unescape } from "./http.mjs";

const ms = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v)) || Date.now();
const oldest = (jobs) => Math.min(...jobs.map((j) => j.postedAt));

// ---------- Jobgether ----------

// "Front End Developer (Vue.js) - fully remote within Europe (m/f/d)" and
// "Staff Backend Engineer - Alerting | UK | Remote": the pipes carry the
// place, which the location field already has.
export function mapJobgether(j) {
  const [title] = String(j.title || "").split(" | ");
  const remote = /remote/i.test(j.remote || "") && !/hybrid/i.test(j.remote || "");
  return {
    id: `jg:${j.id}`,
    source: "Jobgether",
    title: title.trim(),
    company: decode(j.company),
    location: decode(j.location) || (remote ? "Remote" : ""),
    url: j.url,
    postedAt: ms(j.postedAt),
    mode: remote ? "remote" : "on-site",
    salary: j.salaryRange || undefined,
  };
}

export async function jobgether(since) {
  const jobs = [];
  for (const where of ["europe", "anywhere"]) {
    for (let page = 1; page <= 3; page++) {
      let d;
      try {
        d = await get(
          `https://jobgether.com/api/v1/jobs?jobReferences=frontend-developer&locations=${where}&remoteType=full-remote&sort=date&limit=25&page=${page}`,
          { json: true }
        );
      } catch (e) {
        console.warn("jobgether", e.message);
        break;
      }
      const got = (d.jobs || []).map(mapJobgether);
      jobs.push(...got.filter((j) => j.postedAt >= since));
      if (!got.length || !d.pagination?.hasMore || oldest(got) < since) break;
    }
  }
  // A role open to Europe is also open to "anywhere": one copy.
  return [...new Map(jobs.map((j) => [j.id, j])).values()];
}

// The offer page carries the posting as JSON-LD. Used by the lookup in
// scan.mjs for roles worth a brief.
export function jobgetherDesc(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d["@type"] === "JobPosting" && d.description) return plain(d.description);
    } catch {}
  }
  return "";
}

export async function lookupJobgether(url) {
  return { desc: jobgetherDesc(await get(url)) };
}

// ---------- Jobicy ----------

export function mapJobicy(j) {
  return {
    id: `jc:${j.id}`,
    source: "Jobicy",
    title: decode(j.jobTitle),
    company: decode(j.companyName),
    location: decode(j.jobGeo) || "Remote",
    url: j.url,
    postedAt: ms(j.pubDate),
    mode: "remote",
    desc: plain(j.jobDescription || ""),
    salary: j.salaryMin && j.salaryMax ? `${j.salaryMin}-${j.salaryMax} ${j.salaryCurrency || ""}`.trim() : undefined,
  };
}

export async function jobicy(since) {
  const jobs = [];
  for (const [geo, tag] of [
    ["europe", "frontend"],
    ["anywhere", "frontend"],
    ["europe", "react"],
  ]) {
    try {
      const d = await get(`https://jobicy.com/api/v2/remote-jobs?count=50&geo=${geo}&tag=${tag}`, { json: true });
      jobs.push(...(d.jobs || []).map(mapJobicy).filter((j) => j.postedAt >= since));
    } catch (e) {
      console.warn("jobicy", e.message);
    }
  }
  return jobs;
}

// ---------- Arbeitnow ----------

export function mapArbeitnow(j) {
  return {
    id: `an:${j.slug}`,
    source: "Arbeitnow",
    title: decode(j.title),
    company: decode(j.company_name),
    location: decode(j.location) || (j.remote ? "Remote" : ""),
    url: j.url,
    postedAt: ms(j.created_at),
    mode: j.remote ? "remote" : "on-site",
    desc: plain(j.description || ""),
    tags: j.tags || [],
  };
}

export async function arbeitnow(since) {
  const jobs = [];
  for (let page = 1; page <= 3; page++) {
    let d;
    try {
      d = await get(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, { json: true });
    } catch (e) {
      console.warn("arbeitnow", e.message);
      break;
    }
    const got = (d.data || []).map(mapArbeitnow);
    jobs.push(...got.filter((j) => j.postedAt >= since));
    if (!got.length || !d.links?.next || oldest(got) < since) break;
  }
  return jobs;
}

// ---------- Himalayas ----------

export function mapHimalayas(j) {
  const where = (j.locationRestrictions || []).join(", ");
  return {
    id: `hm:${j.guid}`,
    source: "Himalayas",
    title: decode(j.title),
    company: decode(j.companyName),
    location: where || "Worldwide",
    url: j.applicationLink || j.guid,
    postedAt: ms(j.pubDate),
    mode: "remote",
    desc: plain(j.description || "") || decode(j.excerpt),
    salary: j.minSalary && j.maxSalary ? `${j.minSalary}-${j.maxSalary} ${j.currency || ""}`.trim() : undefined,
  };
}

export async function himalayas(since) {
  const jobs = [];
  for (const q of ["frontend engineer", "react"]) {
    for (let page = 1; page <= 3; page++) {
      let d;
      try {
        d = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent&limit=20&page=${page}`, { json: true });
      } catch (e) {
        console.warn("himalayas", e.message);
        break;
      }
      const got = (d.jobs || []).map(mapHimalayas);
      jobs.push(...got.filter((j) => j.postedAt >= since));
      if (got.length < 20 || oldest(got) < since) break;
    }
  }
  return jobs;
}

// ---------- Landing.jobs ----------

// The API has no company field. The URL does: /at/dashlane-pt/staff-engineer.
export function mapLandingjobs(j) {
  const slug = /\/at\/([^/]+)\//.exec(j.url || "")?.[1] || "";
  const company = slug
    .replace(/-pt$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const places = (j.locations || []).map((l) => [l.city, l.country_code].filter(Boolean).join(", "));
  return {
    id: `lj:${j.id}`,
    source: "Landing.jobs",
    title: decode(j.title),
    company,
    location: places.join("; ") || (j.remote ? "Remote" : "Portugal"),
    url: j.url,
    postedAt: ms(j.published_at || j.created_at),
    mode: j.remote ? "remote" : "on-site",
    desc: plain([j.role_description, j.main_requirements, j.nice_to_have].filter(Boolean).join("\n")),
    salary: j.gross_salary_low && j.gross_salary_high ? `${j.gross_salary_low}-${j.gross_salary_high} ${j.currency_code || ""}`.trim() : undefined,
  };
}

export async function landingjobs(since) {
  try {
    const d = await get("https://landing.jobs/api/v1/jobs?limit=100", { json: true });
    return (Array.isArray(d) ? d : []).map(mapLandingjobs).filter((j) => j.postedAt >= since);
  } catch (e) {
    console.warn("landing.jobs", e.message);
    return [];
  }
}

// ---------- Company boards ----------

// One entry of config.companies: { ats: "ashby" | "greenhouse" | "lever",
// slug: "attio", name: "Attio" }. name is optional; the slug stands in.
const nameOf = (c) => c.name || c.slug.charAt(0).toUpperCase() + c.slug.slice(1);

export function mapAshby(c, j) {
  const places = [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].filter(Boolean);
  return {
    id: `co:ashby:${c.slug}:${j.id}`,
    source: "Company board",
    title: decode(j.title),
    company: nameOf(c),
    location: places.join("; ") || (j.isRemote ? "Remote" : ""),
    url: j.jobUrl,
    postedAt: ms(j.publishedAt),
    mode: j.isRemote || /remote/i.test(j.workplaceType || "") ? "remote" : "on-site",
    desc: j.descriptionPlain ? String(j.descriptionPlain).slice(0, 4000) : plain(j.descriptionHtml || ""),
  };
}

export function mapGreenhouse(c, j) {
  const where = decode(j.location?.name);
  return {
    id: `co:greenhouse:${c.slug}:${j.id}`,
    source: "Company board",
    title: decode(j.title),
    company: nameOf(c),
    location: where,
    url: j.absolute_url,
    postedAt: ms(j.first_published || j.updated_at),
    mode: /remote/i.test(where) ? "remote" : "on-site",
    desc: plain(unescape(j.content || "")),
  };
}

export function mapLever(c, j) {
  const where = decode(j.categories?.location);
  return {
    id: `co:lever:${c.slug}:${j.id}`,
    source: "Company board",
    title: decode(j.text),
    company: nameOf(c),
    location: where || (j.workplaceType === "remote" ? "Remote" : ""),
    url: j.hostedUrl,
    postedAt: ms(j.createdAt),
    mode: j.workplaceType === "remote" || /remote/i.test(where) ? "remote" : "on-site",
    desc: j.descriptionPlain ? String(j.descriptionPlain).slice(0, 4000) : plain(j.description || ""),
  };
}

export async function companies(list, since) {
  const jobs = [];
  for (const c of list || []) {
    try {
      let got = [];
      if (c.ats === "ashby") {
        const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`, { json: true });
        got = (d.jobs || []).filter((j) => j.isListed !== false).map((j) => mapAshby(c, j));
      } else if (c.ats === "greenhouse") {
        const d = await get(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`, { json: true });
        got = (d.jobs || []).map((j) => mapGreenhouse(c, j));
      } else if (c.ats === "lever") {
        const d = await get(`https://api.lever.co/v0/postings/${c.slug}?mode=json`, { json: true });
        got = (Array.isArray(d) ? d : []).map((j) => mapLever(c, j));
      } else {
        console.warn(`companies: ${c.slug}: unknown ats "${c.ats}" (ashby, greenhouse or lever)`);
        continue;
      }
      // A company page lists everything open, most of it old. Only what
      // was posted since the last scan is new; the rest is already on the
      // board or was never wanted.
      jobs.push(...got.filter((j) => j.postedAt >= since));
    } catch (e) {
      console.warn(`companies: ${c.slug}: ${e.message}`);
    }
  }
  return jobs;
}
