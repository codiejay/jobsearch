import { execFile } from "node:child_process";
import { promisify } from "node:util";

/* Is the person at this Mac, and is it safe to show a job notice on
   screen? Used by the hourly scan and by the desk route the extension
   calls. Reads macOS only: elsewhere idle is infinite, the screen counts
   as locked, and everything goes to the phone. */

const run = promisify(execFile);
const MAC = process.platform === "darwin";
const out = async (cmd: string, args: string[]) => {
  if (!MAC) return "";
  try {
    return (await run(cmd, args, { timeout: 5000 })).stdout;
  } catch {
    return "";
  }
};

// Seconds since the last key press or mouse move.
export async function idleSeconds(): Promise<number> {
  const m = /"HIDIdleTime" = (\d+)/.exec(await out("ioreg", ["-c", "IOHIDSystem", "-d", "4"]));
  return m ? Number(m[1]) / 1e9 : Infinity;
}

export async function screenLocked(): Promise<boolean> {
  if (!MAC) return true;
  return /"CGSSessionScreenIsLocked"=Yes/.test(await out("ioreg", ["-n", "Root", "-d1"]));
}

// Zoom runs CptHost only while the screen is shared. Browser calls (Meet,
// Teams or Slack on the web) are caught by the extension instead.
export async function appSharing(): Promise<boolean> {
  return !!(await out("pgrep", ["-x", "CptHost"])).trim();
}
