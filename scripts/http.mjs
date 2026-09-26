// The small HTTP and text helpers every feed uses. No network at import.

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

export async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 20000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return opts.json ? res.json() : res.text();
}

// HTML to one line of text.
export const decode = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();

// Escaped HTML ("&lt;p&gt;") back to HTML, once.
export const unescape = (s) =>
  String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

// HTML to plain text with paragraph and list breaks kept, for desc.
export const plain = (html) =>
  String(html ?? "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>|<\/p>|<\/ul>|<\/h\d>|<\/div>/gi, "\n")
    .split("\n")
    .map((l) => decode(l))
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
