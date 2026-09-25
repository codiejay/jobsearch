import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import { getJob, listJobs, putJobs, setPresence, type Job } from "../../lib/store";
import { appSharing } from "../../lib/desk";

/* The extension checks in here about once a minute while Chrome is open:
   whether a tab is sharing the screen, until when alerts are muted, and
   which notices were seen. Back go the roles waiting to be shown. */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const { sharing, holdUntil, seen } = req.body as { sharing?: boolean; holdUntil?: number; seen?: string[] };

  await setPresence({ at: Date.now(), sharing: !!sharing, holdUntil: Number(holdUntil) || 0 });

  if (Array.isArray(seen) && seen.length) {
    const found = (await Promise.all(seen.map((id) => getJob(String(id))))).filter((j): j is Job => !!j);
    for (const j of found) j.deskSeenAt = Date.now();
    await putJobs(found);
  }

  const roles = (await listJobs())
    .filter((j) => j.deskAt && !j.deskSeenAt && (j.status === "drafted" || j.status === "new") && j.brief)
    .sort((a, b) => (b.brief.fit ?? 0) - (a.brief.fit ?? 0))
    .map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      where: j.mode === "remote" ? "Remote" : j.location,
      fit: j.brief.fit,
      verdict: j.brief.verdict,
      at: j.deskAt,
    }));

  // Only the machine itself can see Zoom. Hosted, this is always false.
  return res.json({ roles, appSharing: await appSharing() });
}
