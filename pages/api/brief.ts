import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import * as store from "../../lib/store";
import { loadPerson, writeBrief } from "../../lib/brief";
import { usd } from "../../lib/claude";
import { lookupPosting } from "../../lib/linkedin";

/* Writes the brief and cover letter for one role and saves them on the
   role. A new role moves to "drafted". */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const id = String(req.query.id || "");

  let person;
  try {
    person = await loadPerson(store);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  const job = await store.getJob(id);
  if (!job) return res.status(404).json({ error: "No such role." });

  // No description yet: read the LinkedIn posting first, so the letter
  // isn't written from the title alone. Other sources always carry one.
  let found: { desc?: string; apply?: string; looked?: number } = {};
  if (!job.desc && !job.blurb && id.startsWith("li:")) {
    try {
      const p = await lookupPosting(id);
      if (p.desc) found = { desc: p.desc, apply: p.apply, looked: Date.now() };
    } catch {}
  }
  const desc = found.desc || job.desc || job.blurb || "";
  if (!desc) return res.status(409).json({ error: "No description saved, and the posting couldn't be read. Check it's still up, then try again." });

  try {
    let cost = 0;
    const brief = await writeBrief(job, desc, person, (u) => (cost = usd(u)));
    // Re-read before writing: a scan may have saved while Claude was working.
    const j = await store.getJob(id);
    if (j) {
      Object.assign(j, found);
      j.brief = { ...brief, cost };
      if (j.status === "new") {
        j.status = "drafted";
        j.statusAt = Date.now();
      }
      await store.putJob(j);
    }
    return res.json({ brief: { ...brief, cost }, status: j?.status });
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }
}
