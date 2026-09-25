import { callClaude, type Usage } from "./claude";
import type { Profile } from "./store";

/* The brief for one role: what the job is, how the person fits, what is
   missing, whether to send it, and a cover letter in their voice. One
   structured call. Everything the model knows about the person comes from
   three files in data/: cv.txt, profile.json and voice.md. */

export type Brief = {
  verdict: "send" | "you" | "skip";
  verdictWhy: string;
  fit: number;
  summary: string;
  wants: string[];
  matches: string[];
  gaps: string[];
  flags: string[];
  apply: { method: "email" | "form" | "unknown"; email: string };
  subject: string;
  letter: string;
  writtenAt: number;
  model?: string;
};

export type Person = { cv: string; profile: Profile; voice: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "verdictWhy", "fit", "summary", "wants", "matches", "gaps", "flags", "apply", "subject", "letter"],
  properties: {
    verdict: { type: "string", enum: ["send", "you", "skip"] },
    verdictWhy: { type: "string" },
    fit: { type: "integer" },
    summary: { type: "string" },
    wants: { type: "array", items: { type: "string" } },
    matches: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    flags: { type: "array", items: { type: "string" } },
    apply: {
      type: "object",
      additionalProperties: false,
      required: ["method", "email"],
      properties: {
        method: { type: "string", enum: ["email", "form", "unknown"] },
        email: { type: "string" },
      },
    },
    subject: { type: "string" },
    letter: { type: "string" },
  },
};

// voice.md has two headed sections. Anything else in the file is ignored.
export function parseVoice(md: string): { material: string; sample: string } {
  const section = (name: string) => {
    const m = new RegExp(`^##\\s*${name}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi").exec(md);
    return (m?.[1] || "").trim();
  };
  return { material: section("Worth telling"), sample: section("Sample letter") };
}

const first = (p: Profile) => String(p.firstName || String(p.name || "").split(" ")[0] || "the candidate");

/* How everything written for the person reads, the letter most of all.
   Shared with the form answers in pages/api/fill.ts. */
export function voiceRules(p: Profile, voice: string): string {
  const { material, sample } = parseVoice(voice);
  const name = first(p);
  const site = String(p.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const signoff = [String(p.name || name), site].filter(Boolean).map((x) => `"${x}"`).join(" and ");
  return `HOW EVERYTHING READS
Write every field the way a person talks to a friend: ordinary words, short sentences, nothing fancy. If ${name} wouldn't say it out loud, rewrite it. This holds for the summary, the lists and the letter.
matches are things ${name} built or fixed, said plainly. Never rank, commit counts, line counts, "core engineer" or "top contributor".

HOW THE LETTER SOUNDS
Talk about real work: what ${name} built or fixed, what was hard about it, and what changed because of it. Pick the one or two things from the CV that this role would care about most and tell them the way ${name} would over coffee.
${material ? `Good material, in ${name}'s own words:\n${material}\n` : ""}Never mention contributor rank, commit counts, codebase size in lines or "core engineer". Nobody hiring cares. No list of tools or version numbers; name a tool only when the role asks for it.
Never quote the posting back or praise the company. Never claim a preference, opinion or comparison ("rather than Redux", "over Webpack") unless the CV says it. Only name tools the CV names.
Normal paragraphs of two to five sentences, uneven lengths. Never a stack of one-sentence paragraphs.
Open with "Hi <company> team," and say which role ${name} is applying for in the first sentence. Mention where ${name} is and the timezone when the role is remote. When it is on-site, say once, plainly, whether ${name} is ready to relocate and would need a work visa, as the profile says.
If there is a real gap, state it once, flatly, with no slogan.
Close with one plain line such as "Happy to talk whenever suits you." Vary it between letters. Then ${signoff} on their own lines.
120 to 200 words. Shorter reads more human.
Never use em dashes or en dashes. Use commas, periods, colons or parentheses.
Never use these words or moves, they read as AI: passionate, excited, thrilled, eager, keen, drawn to, resonates, align, leverage, seamless, robust, delve, journey, cutting-edge, fast-paced, dynamic, spearheaded, honed, impactful, deeply, "I believe", "not just X but Y", "it's not X, it's Y", lists of three, a closing paragraph that sums up, a line that sounds like a quote, "I'd still rather ask than wonder", "I'm not going to pretend".
${sample ? `\nAN APPROVED SAMPLE IN ${name.toUpperCase()}'S VOICE (match this register, do not copy its sentences)\n${sample}` : `\nThere is no sample letter yet. Write plainly and keep it short.`}`;
}

export function systemPrompt(p: Profile, voice: string): string {
  const name = first(p);
  const situation = [
    p.location && `${name} lives in ${p.location}${p.timezone ? `, on ${p.timezone}` : ""}.`,
    p.relocation && String(p.relocation),
    p.needsSponsorship === true && `${name} needs visa sponsorship to work on-site outside ${p.homeCountry || "their own country"}, unless the profile says they can move there.`,
    p.needsSponsorship === false && `${name} does not need visa sponsorship.`,
    p.wants && `${name} wants ${p.wants}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You screen job postings for ${p.name || name} and draft their applications.

WHO THEY ARE
The CV is below. It is the only source of facts about ${name}. Never add an employer, number, tool, title or story that is not in it. If the letter would be stronger with a fact you do not have, leave it out and list it under gaps.
${situation}

WHAT TO RETURN
Every field except the letter is a note to ${name}, so write it to them as "you" ("You'd need a work visa"), never by name or as "they".
fit: 0 to 100, how well their skills and experience match what this role asks for. Location, timezone and visa do not lower fit; they go in flags. Be honest and spread the range: 90+ is rare.
summary: two or three plain sentences on what the company does and what the job is.
wants: up to five things the role most needs, in your words.
matches: up to five concrete lines from the CV that meet those needs.
gaps: what the role asks for that the CV does not show. Empty if none.
flags: practical blockers, such as visa sponsorship, a required language, hiring limited to one country, timezone, or seniority mismatch. Empty if none.
apply: how to apply. "email" only when the posting gives an address to send an application to, and put it in email. "form" for an ATS or careers page. Otherwise "unknown". email is "" unless method is email.
verdict:
- "skip" when something truly rules ${name} out: another language required, hiring limited to a country they cannot work in, or clearly the wrong stack or level. Location alone is not a reason to skip: an on-site role in a place they could move to is worth applying to, since many companies sponsor or relocate without saying so. Flag it and let the letter say so.
- "you" when ${name} should write or finish it themselves: fit is 85 or more at a company worth real effort, the form asks custom questions or for a portfolio or take-home, it is a lead or staff role, or a good letter needs facts the CV does not have.
- "send" when the drafted letter can go as is and fit is 75 or more. From 60 to 74 is "you": worth it, but their call. Below 60 is "skip": not worth an application.
verdictWhy: one sentence saying why.
subject: an email subject line, plain, like "Frontend Engineer application, ${p.name || name}".
letter: the cover letter, or "" when the verdict is skip.

${voiceRules(p, voice)}`;
}

// Vanity numbers and words that read as AI, checked after the call.
export const BANNED =
  /\bcommits\b|top contributor|core engineer|passionate|excited|thrilled|\beager\b|\bkeen\b|drawn to|resonat\w*|\balign\w*|leverag\w*|seamless\w*|robust|delve|journey|cutting-edge|fast-paced|spearhead\w*|\bhoned\b|impactful|\bdeeply\b|I believe/gi;

export const noDash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

type JobIn = { title: string; company: string; location: string; mode?: string; source: string; url: string };

export async function writeBrief(job: JobIn, description: string, person: Person, onUsage?: (u: Usage) => void): Promise<Brief> {
  const input = `CV
${person.cv}

POSTING
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}${job.mode ? ` (${job.mode})` : ""}
Source: ${job.source} (${job.url})

${description || "(No description was saved. Judge from the title and company only, and say so in gaps.)"}`;

  let model: string | undefined;
  const ask = (text: string) =>
    callClaude<Omit<Brief, "writtenAt">>({
      system: systemPrompt(person.profile, person.voice),
      schema: SCHEMA,
      input: text,
      timeoutMs: 120_000,
      onUsage: (u) => {
        model = u.model;
        onUsage?.(u);
      },
    });

  // The prompt bans these, but a model slips now and then. One retry that
  // names what it used.
  let b = await ask(input);
  const hits = (x: typeof b) => Array.from(new Set(`${x.letter}\n${x.matches.join("\n")}\n${x.summary}`.match(BANNED) || []));
  const found = hits(b);
  if (found.length) b = await ask(`${input}\n\nA previous draft used these, which are not allowed: ${found.join(", ")}. Write everything again without them.`);

  const fit = Math.max(0, Math.min(100, Math.round(b.fit)));
  return {
    ...b,
    ...gate(b.verdict, fit, b.verdictWhy),
    fit,
    summary: noDash(b.summary),
    letter: noDash(b.letter),
    subject: noDash(b.subject),
    writtenAt: Date.now(),
    model,
  };
}

type Verdict = "send" | "you" | "skip";

export const SEND_MIN = 75;
export const APPLY_MIN = 60;

/* The bar in code, whatever the model said: ready to apply needs fit 75,
   60 to 74 is their call, under 60 isn't worth an application. The reason
   says so once, so gating an old brief again changes nothing. */
export function gate(verdict: Verdict, fit: number, why: string): { verdict: Verdict; verdictWhy: string } {
  const note = (v: Verdict, text: string) => ({ verdict: v, verdictWhy: why.startsWith("Fit is only") ? why : `${text} ${why}` });
  if (verdict !== "skip" && fit < APPLY_MIN) return note("skip", `Fit is only ${fit}, under the ${APPLY_MIN} worth applying for.`);
  if (verdict === "send" && fit < SEND_MIN) return note("you", `Fit is only ${fit}, under the ${SEND_MIN} needed to send as is.`);
  return { verdict, verdictWhy: why };
}

/* For roles sent in from the browser extension: a tweet, a LinkedIn
   post, a careers page. Pulls out the job, if there is one. */

export type Posting = {
  isJob: boolean;
  why: string;
  title: string;
  company: string;
  location: string;
  mode: "remote" | "on-site";
  applyUrl: string;
  description: string;
};

const POSTING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isJob", "why", "title", "company", "location", "mode", "applyUrl", "description"],
  properties: {
    isJob: { type: "boolean" },
    why: { type: "string" },
    title: { type: "string" },
    company: { type: "string" },
    location: { type: "string" },
    mode: { type: "string", enum: ["remote", "on-site"] },
    applyUrl: { type: "string" },
    description: { type: "string" },
  },
};

const POSTING_SYSTEM = `You get the text of a web page, a tweet or a social post that someone saved because it might be a job opening. Pull the job out of it.
isJob: true only if it advertises a role someone can apply for. A person looking for work, a news story or a general company page is false.
why: when isJob is false, one short sentence saying what it is instead. Otherwise "".
title: the role's title as the poster wrote it, without the company name. If several roles are listed, pick the frontend, React or product engineering one.
company: the hiring company, not the site it's posted on.
location: where the job is, in the poster's words, such as "Remote, Europe" or "Lisbon, Portugal". "" if not said.
mode: "remote" only if they hire remotely; hybrid and office roles are "on-site".
applyUrl: the link or email to apply through, if the text gives one, otherwise "".
description: the posting itself, cleaned of navigation, cookie banners and replies, in plain text with line breaks. Keep every requirement, salary and location detail. Do not summarise.`;

export async function readPosting(text: string, url: string, onUsage?: (u: Usage) => void): Promise<Posting> {
  return callClaude<Posting>({ system: POSTING_SYSTEM, schema: POSTING_SCHEMA, input: `URL: ${url}\n\n${text.slice(0, 30000)}`, timeoutMs: 90_000, onUsage });
}

// Everything the drafts may know about the person, read fresh each time
// so an edit to a data file takes effect on the next brief.
export async function loadPerson(store: { getCv(): Promise<string>; getProfile(): Promise<Profile>; getVoice(): Promise<string> }): Promise<Person> {
  const [cv, profile, voice] = await Promise.all([store.getCv(), store.getProfile(), store.getVoice()]);
  return { cv, profile, voice };
}
