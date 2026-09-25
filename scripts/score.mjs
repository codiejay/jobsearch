// Rule scoring for the job scan: is this role your kind of job, can you
// take it from where you are, and how fresh is it. Pure functions, no
// network, so scan.mjs imports them and score.test.mjs checks them.
//
// The title rules are the regexes below. Edit them to change what counts
// as your kind of job. Regions and points come from jobsearch.config.mjs.
//
// The number has two parts. quality (up to 85) is the title, the level,
// where it is, the language and how it applies. fresh (up to 15) is how
// long ago it was posted. The board keeps a role on quality plus full
// freshness, so an old posting from a slow feed is judged on what it is,
// not on when the scan happened to see it.

import config from "../jobsearch.config.mjs";

const RULES = config.regions;

export const FE = /front[- ]?end|frontend|react|ui engineer|web (engineer|developer)|javascript|typescript|next\.?js/i;
export const PRODUCT = /product engineer/i;
export const DESIGN = /design engineer/i;
export const SOFTWARE = /react|typescript|javascript|front[- ]?end|next\.?js|web app|saas|full[- ]?stack|\bapi\b|software engineer/i;
export const OTHER_FE = /\bvue|angular|svelte/i;
export const FULLSTACK = /full[- ]?stack/i;
export const NEVER = /wordpress|joomla|drupal|magento|shopify|cms specialist|\.net|java\b(?!script)|python developer|intern\b|internship|werkstudent|working student|stagiaire|alternan|apprenti/i;
export const OFF = /back[- ]?end|devops|\bsre\b|data (engineer|scien)|machine learning|\bml\b|android|\bios\b|embedded|\bqa\b|test automation|salesforce|sap\b|java\b(?!script)|\.net|php|wordpress|joomla|drupal|magento|cms specialist|designer|recruit|sales|marketing|intern\b|werkstudent|working student|praktik/i;

export const EU_WORDS = /europe|\beu\b|emea|cet|cest|portugal|lisbon|porto|spain|madrid|barcelona|germany|berlin|munich|france|paris|netherlands|amsterdam|ireland|dublin|italy|poland|warsaw|sweden|stockholm|denmark|copenhagen|finland|belgium|austria|vienna|czech|prague|romania|greece|estonia|lithuania|latvia|croatia|hungary|slovakia|slovenia|bulgaria|luxembourg|cyprus|malta/i;
export const WORLD = /worldwide|anywhere|global|any location/i;
export const AMERICAS_ONLY = /\b(us|usa|united states|u\.s\.|canada|americas|latam|north america|nyc|new york|san francisco|sf\b|bay area|seattle|austin|brazil|mexico)\b/i;
// Places a "remote" card can name that still mean local hiring: India,
// the rest of Asia, Oceania and the Gulf. Africa is left out on purpose,
// since the defaults were written for someone in Nigeria.
export const ELSEWHERE = /\b(india|bengaluru|bangalore|hyderabad|pune|chennai|mumbai|delhi|noida|gurgaon|gurugram|kolkata|pakistan|bangladesh|sri lanka|philippines|manila|vietnam|indonesia|malaysia|thailand|singapore|hong kong|taiwan|japan|tokyo|korea|seoul|china|shanghai|beijing|australia|sydney|melbourne|new zealand|auckland|dubai|uae|saudi|riyadh|qatar|doha|israel|tel aviv)\b/i;

export const LOCAL_LANG = /[぀-ヿ㐀-鿿가-힯]|desenvolvedor|d[ée]veloppeur|ing[ée]nieur|entwickler|\((m\/w\/d|w\/m\/d|h\/f|f\/h|gn|m\/f\/d)\)|desarrollador|programador|sviluppatore|ingegnere|programista|ontwikkelaar|german|deutsch|french|fran[cç]ais|dutch|italian|spanish|polish|czech/i;

// The description is in another language, or asks for one.
export function FOREIGN_DESC(d) {
  if (!d) return false;
  if (/(fluent|native|business|good|strong|excellent)[^.]{0,30}(german|french|dutch|spanish|italian|portuguese|polish)|(german|french|dutch|spanish|italian|portuguese|polish)[^.]{0,20}(is a must|required|mandatory|c1|b2)/i.test(d)) return true;
  const w = d.toLowerCase().split(/\s+/);
  const hits = w.filter((x) => ["und", "der", "die", "wir", "nous", "vous", "pour", "avec", "voor", "het", "para", "com", "per", "della"].includes(x)).length;
  return hits / Math.max(1, w.length) > 0.03;
}

export function region(j) {
  if (j.region) return j.region;
  const l = j.where || j.location || "";
  if (/portugal|lisbon|porto/i.test(l)) return "PT";
  if (EU_WORDS.test(l)) return "EU";
  if (WORLD.test(l)) return "WW";
  if (/\buk\b|united kingdom|london/i.test(l)) return "UK";
  if (AMERICAS_ONLY.test(l)) return "US";
  if (ELSEWHERE.test(l)) return "FAR";
  return "?";
}

// Says it will sponsor a visa or help with relocation, and doesn't say no.
export const SPONSORS = /visa sponsorship|sponsor (your |a |the )?(work )?visa|relocation (support|package|assistance|help)|help(ing)? you relocate|we (can |will |do )?sponsor/i;
export const NO_SPONSOR = /(no|not|unable to|cannot|can't|don't|do not|won't) (offer |provide )?(visa )?sponsor|without (visa )?sponsorship|must (already )?(have|hold) (the )?right to work/i;
export const sponsors = (j) => {
  const d = j.desc || j.blurb || "";
  return SPONSORS.test(d) && !NO_SPONSOR.test(d);
};

// Can you take it from where you are, or by moving somewhere you can?
// Remote, on-site in a home region, or elsewhere only with sponsorship.
export const takeable = (j, r) => j.mode === "remote" || RULES.onSite.includes(r) || sponsors(j);

export const FRESH_MAX = 15;

// How fresh a posting is, in points: 15 in its first hour, 0 after ten days.
export function freshness(postedAt, now = Date.now()) {
  const ageH = (now - postedAt) / 36e5;
  return ageH < 1 ? 15 : ageH < 6 ? 12 : ageH < 24 ? 9 : ageH < 72 ? 5 : ageH < 240 ? 2 : 0;
}

// null when the role is not for this person at all. Otherwise:
//   score    quality plus freshness, what the board sorts by
//   best     quality plus full freshness, its score the hour it was
//            posted; the board keeps roles on this
//   fresh    the freshness part on its own
//   region   PT, EU, WW, UK or ? (US and FAR return null)
//   lang     the title or description is in another language
//   takeable it can be taken from home, or by moving to a home region
export function score(j, now = Date.now()) {
  const t = j.title || "";
  let fit = 0;
  if (PRODUCT.test(t) || DESIGN.test(t) || FE.test(t)) fit = 45;
  else if (OTHER_FE.test(t)) fit = 35;
  else if (FULLSTACK.test(t)) fit = 30;
  if (OFF.test(t) && !FE.test(t) && !PRODUCT.test(t) && !DESIGN.test(t)) fit = 0;
  if (NEVER.test(t)) fit = 0;
  if (/manager|\bem\b|\[em\]/i.test(t) && !/product engineer/i.test(t)) fit = 0;
  // Titles that match a frontend word but aren't the job: mobile, backend
  // with a TypeScript mention, Angular or Vue without React.
  if (/react native|mobile|flutter|android|\bios\b/i.test(t)) fit = 0;
  if (/back[- ]?end/i.test(t) && !/front/i.test(t)) fit = 0;
  if (OTHER_FE.test(t) && !/react|next/i.test(t)) fit = Math.min(fit, 25);
  // Full-stack can't reach the board on title alone; it's not the focus.
  if (FULLSTACK.test(t)) fit = Math.min(fit, 25);
  // "Product engineer" and "design engineer" are also factory jobs
  // (lighting, steering, car interiors). Until the posting shows it's
  // software, they score low; the LinkedIn lookup fills in the
  // description and they're scored again.
  if (/mechanical|electrical|hardware|automotive|interior|structural|civil/i.test(t) && !FE.test(t)) fit = 0;
  if ((PRODUCT.test(t) || DESIGN.test(t)) && !FE.test(t)) {
    const d = j.desc || j.blurb || "";
    if (!d) fit = Math.min(fit, 30);
    else if (!SOFTWARE.test(d)) fit = 0;
  }
  if (!fit) return null;
  if (AMERICAS_ONLY.test(t)) return null;

  let level = 20; // mid, or no level stated
  if (/principal|head of|director|vp\b|architect/i.test(t)) level = 5;
  else if (/staff/i.test(t)) level = 11;
  else if (/lead/i.test(t)) level = 14;
  else if (/senior|\bsr\.?\b/i.test(t)) level = 16;
  else if (/junior|\bjr\.?\b|graduate|entry/i.test(t)) level = 10;

  const r = region(j);
  if (r === "US" || r === "FAR") return null;
  // Remote in a target region is best. On-site in a home region is a real
  // option; on-site elsewhere means visa sponsorship, which only drops a
  // few points since many companies sponsor without saying so.
  const remote = j.mode === "remote";
  const where = remote
    ? RULES.remote[r] ?? RULES.remote["?"]
    : RULES.onSite.includes(r)
    ? RULES.onSitePoints.home
    : sponsors(j)
    ? RULES.onSitePoints.sponsored
    : RULES.onSitePoints.other;

  // A title in French, German etc. almost always means the job is too.
  const lang = LOCAL_LANG.test(t) || /[぀-ヿ㐀-鿿가-힯]/.test(j.company || "") || FOREIGN_DESC(j.desc) ? -20 : 0;
  const easy = j.apply === "easy" ? -15 : 0;

  const quality = Math.max(0, fit + level + where + lang + easy);
  const fresh = freshness(j.postedAt, now);
  const clamp = (n) => Math.max(0, Math.min(100, n));
  return {
    score: clamp(quality + fresh),
    best: clamp(quality + FRESH_MAX),
    fresh,
    region: r,
    lang: lang < 0,
    takeable: takeable(j, r),
  };
}
