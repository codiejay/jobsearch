# For the agent setting this up

You are helping someone install Job search, a private job board that runs
on their own machine. Read this whole file, then walk them through it one
step at a time. Run the commands yourself where you can, and tell them
plainly what each one did. Stop and ask when a step needs something only
they have (an API key, their CV, their phone).

## What it is

Every hour a script pulls fresh frontend and product engineering roles
from LinkedIn, the Hacker News hiring thread, Remotive, We Work Remotely
and Working Nomads. It scores each one on the title, level, location,
language and how it applies, keeps the ones worth a look, and asks Claude
to write a brief (what the job is, how they fit, what is missing, whether
to apply) and a cover letter in their voice. The board at
http://localhost:4750 shows the roles. A Chrome extension sends job posts
from any page to the board, fills application forms (it never submits),
and shows new roles on screen while they are at the Mac. When they are
away, the phone gets a ping through the ntfy app.

The letters are only as good as three files in data/: cv.txt (the only
source of facts), profile.json (plain facts and their situation), and
voice.md (what is worth telling, and one letter they would actually send).
Make sure they fill all three. A blank voice.md gives clean, flat letters.

## What they need

- A Mac that stays on. The board runs anywhere, but the "at the desk or
  away" check reads macOS only. On Linux or Windows everything goes to
  the phone.
- Node 22.6 or newer. Check: `node -v`.
- An Anthropic API key. About 6 cents a brief. https://console.anthropic.com
- Chrome, for the extension.
- The ntfy app on their phone, for pings. Free. https://ntfy.sh
- Optional: a Gmail app password to send letters from the board.
  https://myaccount.google.com/apppasswords
- Optional: a free Upstash Redis, only if they will host the board
  somewhere and want the phone to open it. Skip this the first time.

## Steps

Run every command from this folder.

1. `npm install`. Downloads Next.js and a few libraries, about 100 MB.
2. `node bin/jobsearch.mjs init`. Asks for their name, links, where they
   live, timezone, relocation and visa situation. Writes data/profile.json
   and copies the example cv.txt and voice.md into data/. Copies
   .env.example to .env.local.
3. Add `ANTHROPIC_API_KEY=` to .env.local. They paste the key; never ask
   them to paste it into the chat.
4. Replace data/cv.txt with their CV as plain text. Replace both sections
   of data/voice.md: "Worth telling" (three to six lines of real work) and
   "Sample letter" (one letter in their own words, under 200 words). Put
   their CV PDF at data/cv.pdf.
5. Look at jobsearch.config.mjs with them. The defaults are for a
   frontend engineer outside the EU who can move to Portugal. Change:
   - `linkedin.queries` to their titles.
   - `linkedin.geos` to where they can work (LinkedIn geoIds are in the
     URL of a LinkedIn job search for that place).
   - `regions.remote` points and `regions.onSite` (where they live or can
     move to). Regions are PT, EU, UK, WW, US, FAR and ?. US and FAR are
     dropped outright in scripts/score.mjs; edit that file if they can
     work there.
   - The title regexes at the top of scripts/score.mjs if they are not a
     frontend or product engineer.
6. `node bin/jobsearch.mjs doctor`. Fix anything it lists.
7. `npm test`. 21 tests on the scoring and the verdict gate. All pass.
8. `node bin/jobsearch.mjs scan --hours 24 --no-draft`. First scan, no
   Claude calls, a few minutes. It prints how many roles each feed gave
   and how many were kept.
9. `node bin/jobsearch.mjs dev`. Open http://localhost:4750. They should
   see the roles. Leave this running in a terminal.
10. `node bin/jobsearch.mjs scan`. A real scan with drafts. Up to 8 briefs,
    about 20 seconds and 6 cents each. Refresh the board: roles under
    "Ready to apply" and "Write yourself" have a brief and a letter. Read
    one letter together. If it does not sound like them, fix voice.md and
    click "Rewrite" on that role.
11. Extension: open chrome://extensions, turn on Developer mode, Load
    unpacked, pick the `extension` folder. Alt+Shift+J sends the page
    they are on to the board. Alt+Shift+F fills an application form.
    Try the form fill on extension/test-form.html first.
12. Phone: install ntfy, then `node bin/jobsearch.mjs ping --test`. The
    first run prints a topic name like js-8f3a... Subscribe to that topic
    in the app. Run the test again; the phone should buzz.
13. `node bin/jobsearch.mjs schedule install`. Runs the scan every hour
    through launchd. `schedule status` shows the last run and the log.

## Sending letters by email

Some postings give an email address. The board can send the letter from
their own address with the CV attached, after a confirm click. It needs
SMTP_USER and SMTP_PASS in .env.local (Gmail: an app password, not the
account password). One send per role, ever. "Send to me" sends a copy to
themselves first. Without SMTP, the copy button still works.

## Hosting the board (optional, later)

The board only answers on localhost until BOARD_PASSWORD is set. To reach
it from a phone, deploy this folder to Vercel or any Node host, set
BOARD_PASSWORD, BOARD_KEY (for the extension), JOBSEARCH_STORE=redis and
the Upstash keys, and set BOARD_URL in .env.local on the Mac so pings
open it. The Mac still runs the scan; the host only shows the board. The
CV and voice never leave the Mac.

## When something breaks

- `doctor` first. It says what is missing.
- Scan log: `~/Library/Logs/jobsearch-scan.log`.
- "drafts skipped: data/voice.md is missing": step 4.
- LinkedIn returns 429: the scan backs off on its own. Wait an hour.
- A letter uses a fact that is not true: it can only come from cv.txt or
  voice.md. Fix the file, click Rewrite.
- The extension says the board is not running: `node bin/jobsearch.mjs dev`.

## Rules for you, the agent

- Never paste their API key, CV or letters into the chat unless they do.
- Never submit an application for them. The tool fills forms and stops.
- Never change scripts/score.mjs or jobsearch.config.mjs without saying
  what will change on the board and why.
- Do not run `npm run build` while `dev` is running.
