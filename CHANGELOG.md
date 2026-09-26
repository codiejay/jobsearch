# Changelog

Every change that reaches the package, newest first. The version is in
package.json. A new way to use the board bumps the middle number; a fix
bumps the last one.

To update your copy: `git pull`, then `npm run doctor`. Run `npm install`
only when an entry says so.

## 1.1.1 (2026-09-26)

The "roles ready" notice kept its titles on every page. Some sites' CSS
reached into it and blanked the title and company. It now renders in a
shadow root, out of the page's reach. Reload the extension on
chrome://extensions to get it.

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
