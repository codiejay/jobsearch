/* Tells whether two links or two company names point at the same thing.
   Shared by the routes that take input from the extension. */

// One form per link: no query or hash, no trailing slash, lower-case host,
// and twitter.com counted as x.com.
export function bare(u: string) {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^(www|mobile)\./, "").replace(/^twitter\.com$/, "x.com");
    return `${host}${x.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
  }
}

// "Air Apps, Inc." and "air apps" are the same company.
export const same = (a = "", b = "") => {
  const n = (s: string) =>
    s.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|bv|sa|ag)\b|front[- ]end|[^a-z0-9]/g, (m) => (/front/.test(m) ? "frontend" : ""));
  return n(a) !== "" && n(a) === n(b);
};
