/* Reads one LinkedIn posting through the public guest endpoint, no login.
   The scan uses it to fill in descriptions, and the brief route uses it
   when a role has none yet, so a letter is never written from a title. */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();

export type Posting = {
  apply: "company" | "easy" | "unknown";
  desc: string;
  seniority?: string;
  empType?: string;
};

// "Apply" goes to the company's site (apply-link-offsite) or is Easy Apply
// (apply-link-onsite). The description keeps paragraph and list breaks so
// the side panel reads like the post.
export async function lookupPosting(id: string): Promise<Posting> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id.replace(/^li:/, "")}`, {
    headers: { "user-agent": UA },
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`${res.status} linkedin posting`);
  const html = await res.text();
  const apply = /apply-link-offsite/.test(html) ? "company" : /apply-link-onsite/.test(html) ? "easy" : "unknown";
  const rich = (/description__text--rich">([\s\S]*?)<\/section>/.exec(html)?.[1] || "")
    .replace(/^[\s\S]*?show-more-less-html__markup[^>]*>/, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>|<\/p>|<\/ul>|<\/h\d>|<\/strong><\/p>/gi, "\n");
  const desc = rich
    .split("\n")
    .map((l) => decode(l))
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/Show more\s*Show less\s*$/i, "")
    .trim()
    .slice(0, 5000);
  const criteria = Array.from(html.matchAll(/job-criteria-text--criteria">([\s\S]*?)<\/span>/g), (m) => decode(m[1]));
  return { apply, desc, seniority: criteria[0], empType: criteria[1] };
}
