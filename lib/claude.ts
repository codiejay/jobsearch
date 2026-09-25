/* One structured call to Claude. Every prompt in the tool goes through
   here: the brief and letter, the form answers, and reading a posting out
   of a page. Returns the JSON the schema asked for. */

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
  model: string;
}

const DEFAULT_MODEL = "claude-opus-5";

export function modelName(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Rough list price in dollars, for the cost shown on the board.
export function usd(u: Usage): number {
  return u.input * 5e-6 + u.output * 25e-6 + u.cacheRead * 0.5e-6 + u.cacheWrite * 6.25e-6;
}

export async function callClaude<T>(req: {
  system: string;
  schema: object;
  input: string;
  timeoutMs?: number;
  maxTokens?: number;
  onUsage?: (u: Usage) => void;
}): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
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
    });
  if (msg.stop_reason === "refusal") throw new Error(`Claude declined: ${msg.stop_details?.explanation ?? "no reason given"}`);
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of room. Try again.");
  const text = (msg.content ?? []).find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned nothing.");
  return JSON.parse(text) as T;
}
