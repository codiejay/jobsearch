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
  draftMax: 8,
  draftSeconds: 360,

  // Days a role stays on the board when nothing is done with it.
  keepDays: 14,
  keepDaysHn: 35,

  // Phone pings through ntfy.sh. Quiet hours send at low priority.
  ntfy: { server: "https://ntfy.sh", quiet: [23, 7] },

  // Minutes of no key or mouse before "at the desk" becomes "away".
  awayMinutes: 10,
};
