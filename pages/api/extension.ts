import type { NextApiRequest, NextApiResponse } from "next";
import { isLocal } from "../../lib/guard";

/* Hands the extension the key for a hosted board, so it never has to be
   pasted. Only on localhost, and only to the extension: a web page's
   request carries its own Origin and gets nothing. */

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isLocal(req)) return res.status(404).end();
  const origin = String(req.headers.origin || "");
  if (origin && !origin.startsWith("chrome-extension://")) return res.status(403).end();
  return res.json({ key: process.env.BOARD_KEY || "" });
}
