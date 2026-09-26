// Which of the roles a scan found get onto the board. Pure, so
// intake.test.mjs can check it without a network or a store.
//
// A role already on the board is always refreshed. A new role must
// score keepMin on what it is (best: quality plus full freshness, the
// same bar the save uses), must be takeable from where you are when
// takeableOnly is on (remote, on-site where you live or can move, or
// on-site with a visa offer in the posting), and must be one of the
// newMax best new roles of this scan. With ten feeds a loose hour can
// find hundreds; the cap keeps the board readable and the drafts on the
// roles that deserve them.

import { score } from "./score.mjs";

// found: roles from the feeds. known: id -> role already on the board.
// roleKey: company|title normaliser, so one role posted twice is one.
// Returns { update: [{ job, s, old }], add: [{ job, s }] } in the order
// to apply them: refreshes first, then the best new roles.
export function intake(found, known, roleKey, opts = {}) {
  const takeableOnly = opts.takeableOnly !== false;
  const newMax = opts.newMax ?? 30;
  const keepMin = opts.keepMin ?? 0;
  const now = opts.now ?? Date.now();
  const seen = new Set([...known.values()].map(roleKey));
  const update = [];
  const fresh = [];
  for (const job of found) {
    const s = score(job, now);
    if (!s) continue;
    const old = known.get(job.id);
    if (old) {
      update.push({ job, s, old });
      continue;
    }
    if (s.best < keepMin) continue;
    if (takeableOnly && !s.takeable) continue;
    const key = roleKey(job);
    if (seen.has(key)) continue; // same role posted twice
    seen.add(key);
    fresh.push({ job, s });
  }
  fresh.sort((a, b) => b.s.best - a.s.best || b.job.postedAt - a.job.postedAt);
  return { update, add: fresh.slice(0, newMax), skipped: Math.max(0, fresh.length - newMax) };
}
