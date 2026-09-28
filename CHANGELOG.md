# Changelog

Every change that reaches the package, newest first. The version is in
package.json. A new way to use the board bumps the middle number; a fix
bumps the last one.

To update your copy: `git pull`, then `npm run doctor`. Run `npm install`
only when an entry says so.

## 1.3.0 (2026-09-28)

The extension uses your online board by default. Before, "auto" tried
this machine first and only fell back to the online board saved in the
options. With the local board stopped and nothing saved there, the
extension stopped checking in without a word, so the scan thought you
were away and sent every new role to the phone.

Now "auto" uses the online board whenever one is known, and tries
localhost:4750 only when none is. The online board and key can come
from the options page as before, or from a new command:
`jobsearch extension` writes extension/board.json (gitignored) from
BOARD_URL and BOARD_KEY in .env.local. Reload the extension after.

If a check-in fails, the extension icon shows a red "!" and its tooltip
says why.

## 1.2.0 (2026-09-26)

Six more places the scan looks, all free and keyless: Jobgether, Jobicy,
Arbeitnow, Himalayas, Landing.jobs, and the hiring pages of companies you
name in the config (Ashby, Greenhouse or Lever boards). Each feed can be
turned off under `feeds` in jobsearch.config.mjs. See scripts/feeds.mjs.

The gate is stricter, so more feeds does not mean a longer board. A new
role must clear the 85 bar on what it is, must be takeable from where you
are (remote, on-site in a home region, or a visa offer in the posting),
and only the 30 best new roles of a scan get in. The rest are counted in
the log and left out. `takeableOnly` and `newMax` in the config.

Jobgether lists roles without a description; the scan reads the offer
page for the ones worth a brief, ten a scan.

Focus: from "Did you apply?" you can go back to the brief (B), copy the
letter again, or open the posting again. The letter on the brief has a
Copy button, and once the posting is open the brief has "Back to the
question" (B), so no second tab.

`npm run doctor` after pulling. No new packages.

## 1.1.1 (2026-09-26)

The "roles ready" notice kept its titles on every page. Some sites' CSS
reached into it and blanked the title and company. It now renders in a
shadow root, out of the page's reach. Reload the extension on
chrome://extensions to get it.

Both extension notices ignore the page zoom, so a page at 150% no longer
shows a 150% notice.

With BOARD_PASSWORD set, the board on your own machine still opens
without a sign-in, and the extension keeps working there. Before, setting
the password for a hosted board locked the local one too.

AGENT.md: hosting the board is now nine numbered steps, including the
Vercel login wall that blocks the phone on a new project.

## 1.1.0 (2026-09-26)

Drafts without an Anthropic API key. If Claude Code or Codex is installed
and logged in on your computer, the board uses it for the brief, the
cover letter, the form answers and reading a posting sent in from the
extension.

- How it picks: with `ANTHROPIC_API_KEY` set, the API, as before. Without
  it, Claude Code, or Codex if Claude Code isn't installed. `AI=api`,
  `AI=claude` or `AI=codex` in .env.local picks one yourself.
- A model can be pinned with `CLAUDE_MODEL` (API or Claude Code) or
  `CODEX_MODEL`. Without one, the CLI uses its own default.
- It runs on your Claude or ChatGPT plan, so the board shows no cost for
  it. The drawer says which plan it uses instead of "About 6 cents".
- A brief takes longer this way, since the CLI starts up for every call.
- The hourly scan writes 3 briefs a run this way instead of 8, to go easy
  on your plan's limits. Change `draftMaxLocal` in jobsearch.config.mjs.
- It only works where the board runs on your own computer. A hosted board
  on Vercel still needs the API key.
- The CLI runs in an empty temp folder with its tools turned off. It uses
  your login, never your API key.
- `jobsearch doctor` shows which one the board will use, or what to set.
- With Codex, your CV and the letters go to OpenAI instead of Anthropic.

No new packages. Checked: a real Claude Code call answered in the right
shape in 7 seconds; the Codex path was checked against a stand-in only.

## 1.0.0 (2026-09-25)

The first version handed to friends.

- The board, the hourly scan, the Chrome extension, the phone pings and
  the form filler as one folder. Your facts and voice come from
  data/cv.txt, data/profile.json and data/voice.md; the rules from
  jobsearch.config.mjs.
- The `jobsearch` command: init, doctor, dev, scan, ping, sync and the
  hourly launchd job. AGENT.md walks your own coding agent through setup.
- Focus mode: the untouched Ready to apply and Write yourself roles, one
  at a time, best fit first.
- A notice on your screen left unseen for 45 minutes goes to the phone
  only when you are away from the computer.
- Hosted boards can draft: `jobsearch sync` copies your CV, profile,
  voice and CV PDF to your own Redis.
- Roles with no brief say so and never sit above roles with a fit.
- The sign-off line in letters reads the way your sample does.
- .env.example, which `jobsearch init` copies, was missing and is back.
