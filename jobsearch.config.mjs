// The rules the scan runs on. These are the defaults the tool shipped with:
// frontend and product engineering, remote in Europe or worldwide, from a
// person who lives outside the EU and can move to Portugal. Edit to taste.
// The title rules (what counts as your kind of job) live in scripts/score.mjs.

export default {
  // The board runs here. Keep it off 3000, which everything else uses.
  port: 4750,

  // LinkedIn guest search: what to type and where to look. geoId is
  // LinkedIn's number for a place (Worldwide 92000000, EU 91000000, and a
  // country's id is in the URL of a LinkedIn job search for it).
  // wt: "2" remote, "1,3" on-site and hybrid. region tags every result
  // from that search; leave it off for Worldwide so each card's own
  // location is read instead.
  linkedin: {
    queries: [
      "frontend engineer",
      "frontend developer",
      "react developer",
      "product engineer",
      "frontend lead",
      "senior frontend engineer",
      "typescript developer",
      "next.js developer",
      "ui engineer",
    ],
    geos: [
      { geoId: "92000000", location: "Worldwide", wt: "2", mode: "remote" },
      { geoId: "91000000", location: "European Union", wt: "2", mode: "remote", region: "EU" },
      { geoId: "100364837", location: "Portugal", wt: "2", mode: "remote", region: "PT" },
      { geoId: "100364837", location: "Portugal", wt: "1,3", mode: "on-site", region: "PT" },
    ],
  },

  // Regions are PT, EU, UK, WW (worldwide), US, FAR (Asia, Oceania, the
  // Gulf) and ? (unknown). US and FAR are dropped in scripts/score.mjs.
  regions: {
    // Points a remote role earns by region, out of 20.
    remote: { PT: 20, EU: 20, WW: 20, UK: 16, "?": 12 },
    // Regions where an on-site role is takeable without visa sponsorship:
    // where you live, or where you can move.
    onSite: ["PT"],
    // Points for an on-site role: at home, with sponsorship, or without.
    onSitePoints: { home: 18, sponsored: 16, other: 12 },
  },

  // The rule score a role needs to make the board (0 to 100), and the
  // score from which the scan drafts a brief and letter.
  keepMin: 85,
  draftMin: 70,
  // Briefs per scan, and the most the scan spends on them in seconds.
  // Through Claude Code or Codex, each brief comes out of your plan's
  // limits and takes longer, so the scan writes fewer.
  draftMax: 8,
  draftMaxLocal: 3,
  draftSeconds: 360,

  // What gets in. takeableOnly drops any new role you could not take from
  // where you are: not remote, not on-site in a home region, and no visa
  // offer in the posting. newMax is the most new roles one scan may add,
  // best first; the rest are left out and logged. With ten feeds a loose
  // hour finds hundreds, so keep this small.
  takeableOnly: true,
  newMax: 30,

  // The feeds. Set one to false to skip it.
  feeds: {
    linkedin: true,
    hn: true,
    remotive: true,
    weworkremotely: true,
    workingnomads: true,
    jobgether: true, // remote frontend roles, Europe and worldwide
    jobicy: true, // remote roles with the eligible countries listed
    arbeitnow: true, // Europe, mostly on-site Germany, UK and France
    himalayas: true, // remote roles with exact location restrictions
    landingjobs: true, // Portugal
    companies: true, // the boards below
  },

  // Company hiring pages read every scan, for roles the day they open.
  // ats is ashby, greenhouse or lever; slug is the company's name in its
  // careers URL (jobs.ashbyhq.com/attio, job-boards.greenhouse.io/vercel,
  // jobs.lever.co/mistral). name is what the board shows.
  companies: [
    { ats: "ashby", slug: "attio", name: "Attio" },
    { ats: "greenhouse", slug: "vercel", name: "Vercel" },
  ],

  // Days a role stays on the board when nothing is done with it.
  keepDays: 14,
  keepDaysHn: 35,

  // Phone pings through ntfy.sh. Quiet hours send at low priority.
  ntfy: { server: "https://ntfy.sh", quiet: [23, 7] },

  // Minutes of no key or mouse before "at the desk" becomes "away".
  awayMinutes: 10,
};
