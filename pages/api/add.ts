import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import * as store from "../../lib/store";
import { loadPerson, readPosting, writeBrief } from "../../lib/brief";
import { usd } from "../../lib/claude";
import { bare, same } from "../../lib/match";

/* Takes a role sent from the browser extension: the page's URL and, when
   it has it, the page text or a selection. Reads the job out of it,
   writes the brief and letter, and saves it tagged "Added by you". */

// Plain text from HTML, for links sent without the page open.
function strip(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

type Saved = { id: string; url: string; sourceUrl?: string; title: string; company: string; brief?: { verdict: string } };

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const { url, text: sent, title: pageTitle } = (req.body || {}) as { url?: string; text?: string; title?: string };
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "Send a page or link." });

  const id = `manual:${crypto.createHash("sha1").update(bare(url)).digest("hex").slice(0, 12)}`;
  const data = { jobs: await store.listJobs() };
  const already = (had: Saved) =>
    res.json({ ok: true, already: true, title: had.title, company: had.company, verdict: had.brief?.verdict });

  // Same link already on the board, from a scan or sent before. A feed or
  // profile page (x.com/someone) holds many posts, so it only counts as a
  // repeat through the role check below.
  const feed = /^x\.com\/[^/]+$|^linkedin\.com\/(in|company)\/[^/]+$|^linkedin\.com\/feed/.test(bare(url));
  const sameLink = !feed && (data.jobs as Saved[]).find(
    (j) => j.id === id || bare(j.url) === bare(url) || (j.sourceUrl && bare(j.sourceUrl) === bare(url))
  );
  if (sameLink) return already(sameLink);

  let text = (sent || "").trim();
  if (text.length < 200) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
      text = `${pageTitle || ""}\n${text}\n${strip(await r.text())}`.trim();
    } catch {}
  }
  if (text.length < 80)
    return res.status(422).json({ error: "Couldn't read that link. Open it and send the page instead." });

  let person;
  try {
    person = await loadPerson(store);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  try {
    let cost = 0;
    const p = await readPosting(text, url, (u) => (cost += usd(u)));
    if (!p.isJob) return res.status(422).json({ error: `Not a job: ${p.why}` });

    // Same role reached another way: the scan found it, or another post
    // or link about it was sent before. Checked before the letter, so a
    // repeat costs one short read and nothing more.
    const sameRole = (data.jobs as Saved[]).find(
      (j) =>
        (same(j.company, p.company) && same(j.title, p.title)) ||
        (p.applyUrl.startsWith("http") && bare(j.url) === bare(p.applyUrl))
    );
    if (sameRole) return already(sameRole);

    const job = {
      id,
      source: "Manual",
      manual: true,
      title: p.title || pageTitle || "Untitled role",
      company: p.company || new URL(url).hostname.replace(/^www\./, ""),
      location: p.location || "Not stated",
      mode: p.mode,
      region: "?",
      url: /^https?:\/\//.test(p.applyUrl) ? p.applyUrl : url,
      sourceUrl: url,
      postedAt: Date.now(),
      firstSeen: Date.now(),
      desc: p.description,
      takeable: true,
      score: 0,
      status: "new",
    };
    const brief = await writeBrief(job, p.description, person, (u) => (cost += usd(u)));

    // One role, written on its own, so whatever the hourly scan saved
    // while Claude was working stays.
    await store.putJob({
      ...job,
      score: brief.fit,
      brief: { ...brief, cost },
      status: "drafted",
      statusAt: Date.now(),
    });
    return res.json({ ok: true, title: job.title, company: job.company, verdict: brief.verdict, fit: brief.fit, cost });
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }
}
