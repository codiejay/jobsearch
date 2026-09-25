import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import { getJob, putJobs, type Job } from "../../lib/store";

/* Sets a role's status. appliedAt is the first time a role moved past
   "new": later stages keep it, and undoing back to new or skipped clears it. */

const STATUSES = ["new", "drafted", "applied", "interview", "offer", "rejected", "skipped"];
const OUT = ["applied", "interview", "offer", "rejected"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const { ids, status } = req.body as { ids: string[]; status: string };
  if (!Array.isArray(ids) || !STATUSES.includes(status)) return res.status(400).end();
  const found = (await Promise.all(ids.map((id) => getJob(String(id))))).filter((j): j is Job => !!j);
  for (const j of found) {
    j.status = status;
    j.statusAt = Date.now();
    if (OUT.includes(status)) j.appliedAt ??= j.statusAt;
    else delete j.appliedAt;
  }
  await putJobs(found);
  return res.json({ ok: true });
}
