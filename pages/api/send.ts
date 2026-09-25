import type { NextApiRequest, NextApiResponse } from "next";
import { buildMessage, sendMail } from "../../lib/mail";
import { authed } from "../../lib/guard";
import { getJob, getProfile, putJob } from "../../lib/store";
import { noDash } from "../../lib/brief";

/* Sends one role's cover letter by email, with the CV attached, after the
   person confirms on the page. One send per role: the send is saved on
   the role as sentMail and a second try is refused. toSelf sends to your
   own address and saves nothing. */

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
// roles with a send in progress, so a double click can't send twice
const busy = new Set<string>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const { id, body, confirm, dryRun, toSelf } = (req.body || {}) as { id?: string; body?: string; confirm?: boolean; dryRun?: boolean; toSelf?: boolean };
  if (confirm !== true) return res.status(400).json({ error: "Confirm the send first." });
  const text = typeof body === "string" ? noDash(body).trim() : "";
  if (!text) return res.status(400).json({ error: "The letter is empty." });

  const job = await getJob(String(id || ""));
  if (!job) return res.status(404).json({ error: "No such role." });
  if (job.sentMail) return res.status(409).json({ error: `Already sent on ${new Date(job.sentMail.at).toDateString()}.` });
  const b = job.brief;
  if (b?.apply?.method !== "email" || !EMAIL.test(b.apply.email || "")) return res.status(409).json({ error: "This role doesn't apply by email." });

  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  let to = b.apply.email as string;
  if (toSelf) {
    to = process.env.SMTP_USER || "";
    if (!to) return res.status(400).json({ error: "Add SMTP_USER and SMTP_PASS to .env.local, then restart the board." });
  }
  const subject = String(b.subject || `Application: ${job.title}`);

  if (busy.has(job.id)) return res.status(409).json({ error: "Already sending." });
  busy.add(job.id);
  let sent;
  try {
    sent = await sendMail(buildMessage(profile, { to, subject, body: text }), { dryRun: !!dryRun });
  } catch (e) {
    busy.delete(job.id);
    return res.status(502).json({ error: (e as Error).message });
  }

  let at: number | undefined;
  if (!dryRun && !toSelf) {
    // Re-read before writing: the scan may have saved meanwhile.
    const j = await getJob(job.id);
    if (j) {
      at = Date.now();
      j.sentMail = { to, subject, body: text, at, messageId: sent.messageId };
      j.status = "applied";
      j.statusAt = at;
      await putJob(j);
    }
  }
  busy.delete(job.id);
  return res.json({ ok: true, to, messageId: sent.messageId, dryRun: !!dryRun, toSelf: !!toSelf, at, ...(dryRun ? { message: sent.message } : {}) });
}
