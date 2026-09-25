import fs from "node:fs/promises";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import { DIR, getProfile } from "../../lib/store";

/* The CV PDF, for the extension to drop into a form's resume field. */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  let file = "cv.pdf";
  try {
    file = String((await getProfile()).cvFile || file);
  } catch {}
  const safe = path.basename(file);
  try {
    const bytes = await fs.readFile(path.join(DIR, safe));
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${safe}"`);
    return res.send(bytes);
  } catch {
    return res.status(404).json({ error: `data/${safe} is missing. Put your CV PDF there.` });
  }
}
