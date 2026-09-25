import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import { getCvPdf } from "../../lib/store";

/* The CV PDF, for the extension to drop into a form's resume field. */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  const pdf = await getCvPdf();
  if (!pdf) return res.status(404).json({ error: "No CV PDF. Put it at data/cv.pdf (hosted: run jobsearch sync)." });
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `inline; filename="${pdf.name}"`);
  return res.send(pdf.bytes);
}
