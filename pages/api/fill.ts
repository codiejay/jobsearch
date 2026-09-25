import type { NextApiRequest, NextApiResponse } from "next";
import { authed } from "../../lib/guard";
import * as store from "../../lib/store";
import { callClaude, usd } from "../../lib/claude";
import { BANNED, loadPerson, noDash, voiceRules, type Brief, type Person } from "../../lib/brief";
import { bare, same } from "../../lib/match";

/* Answers an application form the person has open, for the browser
   extension to fill in. Plain facts come from data/profile.json, written
   answers from the CV and the role's brief. It never submits anything: the
   extension fills the fields and the person reviews and sends. */

type Field = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  maxLength?: number;
};

type Kind = "fact" | "written" | "choice" | "skip";
type Answer = { key: string; value: string; kind: Kind; note: string };

type Saved = {
  id: string;
  url: string;
  sourceUrl?: string;
  title: string;
  company: string;
  desc?: string;
  blurb?: string;
  brief?: Brief;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aiBan", "answers"],
  properties: {
    aiBan: { type: "boolean" },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "kind", "note"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          kind: { type: "string", enum: ["fact", "written", "choice", "skip"] },
          note: { type: "string" },
        },
      },
    },
  },
};

const first = (p: Person) => String(p.profile.firstName || String(p.profile.name || "").split(" ")[0] || "the candidate");

function system(person: Person): string {
  const name = first(person);
  const p = person.profile;
  const home = String(p.homeCountry || "their own country");
  return `You fill in a job application form for ${p.name || name}. You get the CV, the profile (plain facts), the brief written for this role if there is one, the text of the page the form is on, and the form's fields. Return one answer per field, by key. ${name} reviews every answer and submits the form themselves.

THE FOUR KINDS
fact: a field the profile answers directly (name, email, phone, links, location, timezone, years of experience). Copy the profile value as is. If the profile value is blank, the kind is "skip" and the note says which profile field to fill, such as "Add your phone in profile.json". Never make up a phone number, salary, date or notice period.
choice: a select, radio or checkbox field. value must be exactly one of the field's options, copied character for character. A single checkbox has the options "Yes" and "No".
- Willing to work from the required location, or to relocate: go by the profile's relocation line. ${p.relocation ? `It says: "${p.relocation}"` : "It is blank, so skip and say so."}
- Visa, work permit or sponsorship: answer truthfully from the profile. needsSponsorship ${p.needsSponsorship === true ? `true means ${name} does need sponsorship and does not have the right to work there, unless the location is ${home}.` : p.needsSponsorship === false ? `false means ${name} does not need sponsorship.` : "is not set, so skip and say so."}
- Consent to data processing or to the privacy policy: "skip". ${name} ticks those.
written: free text the profile does not answer. A cover letter field gets the letter from the brief, unchanged. Questions like "why us", "additional information", "motivation to apply" or "anything else" get a short answer in ${name}'s voice, 40 to 120 words, and never more than the field's maxLength in characters. Written answers follow the voice rules below, except the greeting, sign-off and word count, which are for the letter only. Short answers have no greeting and no sign-off.
skip: value "". Use it for EEO, diversity and demographic questions (gender, race, ethnicity, veteran, disability, pronouns), file uploads, anything ${name} must decide (start date, notice period and salary when the profile has them blank), and anything you can't answer truthfully from the inputs. The note says in a few plain words what to do, such as "Pick your start date".

AI BAN
Set aiBan true if the posting, the page or the brief's flags say AI-written or AI-assisted applications are not allowed, or that using AI in the application disqualifies you. When aiBan is true, every written field is "skip" with the note "This company bans AI-written answers. Write this one yourself." Facts and choices still fill.

NOTES
note is for ${name}, a few plain words. Empty for facts and choices that need no comment.

Every fact comes from the CV or the profile. Never add an employer, number, tool or story that isn't there. That includes what was hard about a project or how it went: say it only if the CV says it. A short answer that sticks to what was built is better than one with an invented detail.

${voiceRules(p, person.voice)}`;
}

// A posting that says AI help in the application counts against you: one
// sentence that names AI, a ban and the application.
const AI = /\b(AI|A\.I\.|ChatGPT|GPT|LLMs?|artificial intelligence|generative)\b/i;
const BAN = /\b(not (be )?(allowed|permitted|accepted|considered)|disqualif\w*|prohibit\w*|forbid\w*|reject\w*|banned|do not use|don't use|must not use|never use|without (the )?(use|help) of)\b/i;
const APPLY = /\b(applica\w*|apply|applying|cover letter|CV|resume|answers?|submissions?|responses?)\b/i;
const bansAi = (s: string) => s.split(/(?<=[.!?\n])\s+/).some((x) => AI.test(x) && BAN.test(x) && APPLY.test(x));

// A fact the forms ask for that may not be filled in yet. A blank one
// stays blank on the form.
const BLANKS: { key: string; label: RegExp; note: string }[] = [
  { key: "phone", label: /phone|mobile|telephone|whatsapp/i, note: "Add your phone in profile.json" },
  { key: "noticePeriod", label: /notice period|start date|when can you start|available to start|availability/i, note: "Pick your start date" },
  { key: "salaryExpectation", label: /salary|compensation|pay expectation|expected pay|\brate\b/i, note: "Add your salary in profile.json" },
];

// Cut to the last full sentence that fits.
function fit(s: string, max?: number) {
  if (!max || s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.endsWith(".") ? max - 1 : -1);
  return end > 0 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")).trim();
}

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authed(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const { url = "", title = "", pageText = "", fields } = (req.body || {}) as {
    url?: string;
    title?: string;
    pageText?: string;
    fields?: Field[];
  };
  if (!Array.isArray(fields) || !fields.length) return res.status(400).json({ error: "No form fields found on this page." });

  let person: Person;
  try {
    person = await loadPerson(store);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  const { cv, profile } = person;

  // The role this form is for: same link first, then a board company named
  // in the page title, then in the page text. bare() drops the query, but on
  // some sites the query is the page (news.ycombinator.com/item?id=...), so
  // a bare match only counts when one role alone has that link.
  const jobs = (await store.listJobs()) as Saved[];
  const text = String(pageText).slice(0, 20000);
  const full = (u: string) => {
    try {
      return bare(u) + new URL(u).search;
    } catch {
      return bare(u);
    }
  };
  const links = (j: Saved) => [j.url, j.sourceUrl].filter((l): l is string => !!l);
  const byLink = () => {
    if (!url) return null;
    const exact = jobs.find((j) => links(j).some((l) => full(l) === full(url)));
    if (exact) return exact;
    const near = jobs.filter((j) => links(j).some((l) => bare(l) === bare(url)));
    return near.length === 1 ? near[0] : null;
  };
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const names = (company: string, where: string) => {
    const n = words(company).length;
    if (!n) return false;
    const w = words(where);
    for (let i = 0; i + n <= w.length; i++) if (same(w.slice(i, i + n).join(" "), company)) return true;
    return false;
  };
  const role =
    byLink() ||
    jobs.find((j) => j.brief && names(j.company, title)) ||
    jobs.find((j) => j.brief && names(j.company, text.slice(0, 4000))) ||
    null;
  const b = role?.brief;
  const posting = role ? (role.desc || role.blurb || "").slice(0, 8000) : "";

  const aiBanned =
    bansAi(text) || bansAi(posting) ||
    !!b?.flags.some((f) => /\bAI\b/.test(f) && /disqualif|ban|not allowed|yourself|without/i.test(f));

  // Upload fields are the extension's job: the resume gets the CV PDF
  // (fetched from /api/cv, named as below), the rest are left to the person.
  const resume = (f: Field) => f.type === "file" && /resume|résumé|\bcv\b|curriculum/i.test(f.label);
  const letterField = (f: Field) => f.type !== "file" && /cover(ing)? letter/i.test(f.label);
  const cvName = `${profile.name || "CV"} CV.pdf`;
  const fixed = new Map<string, Answer>();
  for (const f of fields) {
    if (resume(f)) fixed.set(f.key, { key: f.key, value: cvName, kind: "fact", note: "" });
    else if (f.type === "file") fixed.set(f.key, { key: f.key, value: "", kind: "skip", note: "Upload this yourself" });
    else if (letterField(f) && b?.letter && !aiBanned)
      fixed.set(f.key, { key: f.key, value: fit(noDash(b.letter), f.maxLength), kind: "written", note: "The drafted letter" });
  }
  const ask = fields.filter((f) => !fixed.has(f.key));

  const input = `CV
${cv}

PROFILE
${JSON.stringify(profile, null, 1)}

ROLE
${
  role
    ? `${role.title} at ${role.company}
${
  b
    ? `Summary: ${b.summary}
They want: ${b.wants.join("; ")}
They have: ${b.matches.join("; ")}
Gaps: ${b.gaps.join("; ") || "none"}
Flags: ${b.flags.join("; ") || "none"}
Letter:
${b.letter || "(none)"}`
    : "(No brief yet.)"
}

POSTING
${posting || "(not saved)"}`
    : "(Not on the board. Answer from the CV, the profile and the page alone.)"
}

${aiBanned ? "A check of the posting found it bans AI-written applications. Set aiBan true.\n\n" : ""}PAGE
URL: ${url}
Title: ${title}

${text || "(no text)"}

FIELDS
${JSON.stringify(ask, null, 1)}`;

  let cost = 0;
  const call = (extra = "") =>
    callClaude<{ aiBan: boolean; answers: Answer[] }>({
      system: system(person),
      schema: SCHEMA,
      input: input + extra,
      timeoutMs: 120_000,
      onUsage: (u) => (cost += usd(u)),
    });

  try {
    let out = ask.length ? await call() : { aiBan: false, answers: [] };
    // The prompt bans these words, but a model slips now and then. One
    // retry that names them.
    const hits = (o: typeof out) =>
      Array.from(new Set(o.answers.filter((a) => a.kind === "written").flatMap((a) => a.value.match(BANNED) || [])));
    const found = hits(out);
    if (found.length)
      out = await call(`\n\nA previous draft used these, which are not allowed: ${found.join(", ")}. Write the answers again without them.`);

    const aiBan = aiBanned || out.aiBan;
    const byKey = new Map(out.answers.map((a) => [a.key, a]));
    const answers: (Answer & { label: string })[] = fields.map((f) => {
      const skip = (note: string) => ({ key: f.key, label: f.label, value: "", kind: "skip" as Kind, note });
      const a = fixed.get(f.key) || byKey.get(f.key);
      if (!a) return skip("Not answered");
      if (a.kind === "skip" || !a.value.trim()) return skip(a.note || "Left for you");
      // Blank facts stay blank, whatever the model wrote.
      const blank = BLANKS.find((x) => x.label.test(f.label) && !String(profile[x.key] ?? "").trim());
      if (blank && a.kind !== "choice") return skip(blank.note);
      if (a.kind === "written") {
        if (aiBan) return skip("This company bans AI-written answers. Write this one yourself.");
        const value = fit(noDash(a.value.trim()), f.maxLength);
        BANNED.lastIndex = 0;
        if (BANNED.test(value)) return skip("The draft broke the voice rules. Write this one yourself.");
        return { ...a, key: f.key, label: f.label, value };
      }
      if (a.kind === "choice") {
        const opts = f.options?.length ? f.options : f.type === "checkbox" ? ["Yes", "No"] : [];
        const hit = opts.find((o) => o === a.value) || opts.find((o) => o.trim().toLowerCase() === a.value.trim().toLowerCase());
        if (!hit) return skip(a.note || "Pick this one yourself");
        return { ...a, key: f.key, label: f.label, value: hit };
      }
      return { ...a, key: f.key, label: f.label, value: noDash(a.value.trim()) };
    });

    // Keep the answers on the role. Re-read first: the scan and the page
    // write to the board too. The status stays as it is.
    if (role) {
      const j = await store.getJob(role.id);
      if (j) {
        j.form = { url, filledAt: Date.now(), answers };
        await store.putJob(j);
      }
    }

    return res.json({
      matched: role ? { company: role.company, title: role.title } : null,
      note: role ? "" : "No role on your board matched. Answers come from your CV and this page.",
      answers,
      aiBan,
      cost,
    });
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }
}
