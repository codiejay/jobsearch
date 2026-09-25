// Reads .env.local for the scripts, the way Next reads it for the board.
// Anything already in the environment wins.
import { readFileSync } from "node:fs";
import path from "node:path";

export function loadEnv() {
  try {
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
