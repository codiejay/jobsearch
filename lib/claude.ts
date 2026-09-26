/* One structured call to Claude. Every prompt in the tool goes through
   here: the brief and letter, the form answers, and reading a posting out
   of a page. Returns the JSON the schema asked for.

   Three ways to reach a model, picked by aiSource(): the Anthropic API with
   a key, or a Claude Code or Codex login on this machine. The CLI ways only
   work where the board runs on your own computer, not on Vercel. */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
  model: string;
  source?: AiSource;
}

export type AiSource = "api" | "claude" | "codex";

const DEFAULT_MODEL = "claude-opus-5";

export function modelName(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Rough list price in dollars, for the cost shown on the board. A CLI
// call runs on the person's plan, so it costs nothing extra.
export function usd(u: Usage): number {
  if (u.source && u.source !== "api") return 0;
  return u.input * 5e-6 + u.output * 25e-6 + u.cacheRead * 0.5e-6 + u.cacheWrite * 6.25e-6;
}

const found = new Map<string, boolean>();
function onPath(bin: string): boolean {
  if (!found.has(bin)) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    found.set(bin, r.status === 0);
  }
  return found.get(bin)!;
}

/* AI in .env.local picks one: api, claude or codex. Without it: the API if
   a key is set, else Claude Code if installed, else Codex. Null means none
   of them can run here. */
export function aiSource(): AiSource | null {
  const want = (process.env.AI || "").trim().toLowerCase();
  if (want === "api") return process.env.ANTHROPIC_API_KEY ? "api" : null;
  if (want === "claude" || want === "codex") return onPath(want) ? want : null;
  if (want) return null;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  if (onPath("claude")) return "claude";
  if (onPath("codex")) return "codex";
  return null;
}

export function aiReady(): boolean {
  return aiSource() !== null;
}

// What to tell the person when aiSource() is null.
export function aiMissing(): string {
  const want = (process.env.AI || "").trim().toLowerCase();
  if (want === "api") return "AI=api needs ANTHROPIC_API_KEY in .env.local.";
  if (want === "claude") return "AI=claude, but the claude command isn't installed. Install Claude Code and log in once.";
  if (want === "codex") return "AI=codex, but the codex command isn't installed. Install Codex and log in once.";
  if (want) return `AI=${want} isn't one of api, claude or codex. Fix it in .env.local.`;
  return "No way to reach a model. Add ANTHROPIC_API_KEY to .env.local, or install Claude Code or Codex on this computer and log in once.";
}

export async function callClaude<T>(req: {
  system: string;
  schema: object;
  input: string;
  timeoutMs?: number;
  maxTokens?: number;
  onUsage?: (u: Usage) => void;
}): Promise<T> {
  const source = aiSource();
  if (!source) throw new Error(aiMissing());
  if (source === "claude") return viaClaudeCode<T>(req);
  if (source === "codex") return viaCodex<T>(req);
  const key = process.env.ANTHROPIC_API_KEY!;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 90_000);

  const post = () =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelName(),
        max_tokens: req.maxTokens ?? 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
        system: req.system,
        messages: [{ role: "user", content: req.input }],
      }),
    });

  let res: Response;
  try {
    try {
      res = await post();
    } catch (e) {
      // A dropped connection gets one more try. An answered error does not.
      if (ctrl.signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 2000));
      res = await post();
    }
  } catch {
    if (ctrl.signal.aborted) throw new Error("Claude took too long to answer. Try again.");
    throw new Error("Couldn't reach Claude. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = await res.json();
  if (req.onUsage && msg.usage)
    req.onUsage({
      input: msg.usage.input_tokens ?? 0,
      output: msg.usage.output_tokens ?? 0,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      ms: Date.now() - t0,
      model: msg.model ?? modelName(),
      source: "api",
    });
  if (msg.stop_reason === "refusal") throw new Error(`Claude declined: ${msg.stop_details?.explanation ?? "no reason given"}`);
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of room. Try again.");
  const text = (msg.content ?? []).find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned nothing.");
  return JSON.parse(text) as T;
}

// ---------- the CLI ways ----------

type Req = Parameters<typeof callClaude>[0];

// A CLI starts up, thinks and writes a whole letter, so it gets longer than
// the API does.
const CLI_MIN_MS = 300_000;

/* Runs a command with text on stdin, in an empty folder so it picks up no
   project files. The timeout kills it. */
function run(bin: string, args: string[], stdin: string, ms: number, cwd: string): Promise<{ code: number; out: string; err: string }> {
  // Its own login, not the key or the session of whatever started the board.
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "OPENAI_API_KEY"]) delete env[k];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, ms);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start ${bin}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (late) reject(new Error(`${bin} took too long to answer. Try again.`));
      else resolve({ code: code ?? 1, out, err });
    });
    child.stdin.end(stdin);
  });
}

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), "jobsearch-ai-"));
}

async function viaClaudeCode<T>(req: Req): Promise<T> {
  const t0 = Date.now();
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(req.schema),
    "--system-prompt", req.system,
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
  const dir = scratch();
  try {
    const r = await run("claude", args, req.input, Math.max(req.timeoutMs ?? 0, CLI_MIN_MS), dir);
    let msg: any;
    try {
      msg = JSON.parse(r.out);
    } catch {
      throw new Error(`Claude Code failed: ${(r.err || r.out).trim().slice(0, 300) || `exit ${r.code}`}`);
    }
    if (msg.is_error) throw new Error(`Claude Code: ${String(msg.result || msg.subtype || "error").slice(0, 300)}`);
    const u = msg.usage ?? {};
    req.onUsage?.({
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      ms: Date.now() - t0,
      model: Object.keys(msg.modelUsage ?? {})[0] ?? "claude-code",
      source: "claude",
    });
    if (msg.structured_output) return msg.structured_output as T;
    if (typeof msg.result === "string" && msg.result.trim()) return JSON.parse(msg.result) as T;
    throw new Error("Claude Code returned nothing.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function viaCodex<T>(req: Req): Promise<T> {
  const t0 = Date.now();
  const dir = scratch();
  const schema = path.join(dir, "schema.json");
  const last = path.join(dir, "answer.json");
  writeFileSync(schema, JSON.stringify(req.schema));
  const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--output-schema", schema, "-o", last];
  if (process.env.CODEX_MODEL) args.push("-m", process.env.CODEX_MODEL);
  args.push("-");
  try {
    // Codex has no system prompt flag, so the instructions lead the input.
    const r = await run("codex", args, `${req.system}\n\n---\n\n${req.input}`, Math.max(req.timeoutMs ?? 0, CLI_MIN_MS), dir);
    let text = "";
    try {
      text = readFileSync(last, "utf8").trim();
    } catch {}
    if (!text) throw new Error(`Codex failed: ${(r.err || r.out).trim().slice(-300) || `exit ${r.code}`}`);
    req.onUsage?.({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: Date.now() - t0, model: process.env.CODEX_MODEL || "codex", source: "codex" });
    return JSON.parse(text) as T;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
