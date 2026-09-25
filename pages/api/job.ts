import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import { getJob } from "../../lib/store";

/* One role's long fields (description, HN post text) for the side panel.
   The table page leaves them out to stay light. */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  const j = await getJob(String(req.query.id || ""));
  if (!j) return res.status(404).end();
  return res.json({ desc: j.desc || j.blurb || "", seniority: j.seniority, empType: j.empType, brief: j.brief || null, form: j.form || null, sentMail: j.sentMail || null });
}
