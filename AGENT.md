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
3. Ask how they want drafts written. With an Anthropic API key: they add
   `ANTHROPIC_API_KEY=` to .env.local and paste the key themselves; never
   ask them to paste it into the chat. Without one: Claude Code or Codex,
   installed and logged in on this computer, is enough, and nothing goes
   in .env.local. `AI=claude` or `AI=codex` picks one when both are
   installed. That way runs on their plan and only works on this
   computer, not on a hosted board.
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

## Hosting the board, so the phone can open it (optional)

On a laptop the board answers only on localhost. To open it from a phone
it has to live on a server. Vercel's free plan and Upstash's free plan are
enough. The Mac still runs the hourly scan; the server only shows the
board and writes briefs for roles sent in from the phone. The hosted
board needs an Anthropic API key. Claude Code and Codex only work on the
Mac.

Do this after everything above works on the Mac. Every command runs from
this folder.

1. Redis. At https://upstash.com make a free Redis database. Copy its
   REST URL and REST token. Add to .env.local on the Mac:

   ```
   JOBSEARCH_STORE=redis
   KV_REST_API_URL=
   KV_REST_API_TOKEN=
   ```

   Restart the board (`node bin/jobsearch.mjs dev`). From now on the Mac
   and the server share one board. Roles already in data/board.json are
   not carried over; the next scan fills the new store.

2. Password and key. Add to .env.local, with values they choose:

   ```
   BOARD_PASSWORD=   what they type on the phone to open the board
                     (their own machine never asks for it)
   BOARD_KEY=        a long random string, for the extension
   ```

   Make the key with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

3. Copy their files to Redis: `node bin/jobsearch.mjs sync`. Run it again
   whenever cv.txt, profile.json, voice.md or cv.pdf change. Without it the
   hosted board shows roles but cannot draft or send.

4. Vercel. `npm install -g vercel`, then `vercel login` (opens the
   browser once), then `vercel link` and accept a new project. Add the
   same values as production env vars, one at a time:

   ```
   vercel env add ANTHROPIC_API_KEY production
   vercel env add BOARD_PASSWORD production
   vercel env add BOARD_KEY production
   vercel env add JOBSEARCH_STORE production        (value: redis)
   vercel env add KV_REST_API_URL production
   vercel env add KV_REST_API_TOKEN production
   vercel env add SMTP_USER production              (only if they send email)
   vercel env add SMTP_PASS production
   ```

   Each command asks for the value; they paste it in the terminal, never
   in the chat. Then `vercel deploy --prod`. The build runs on Vercel,
   not on the Mac. It prints the address, like https://name.vercel.app.

5. Turn off Vercel's own login wall. New projects get "Vercel
   Authentication" on by default, which blocks the phone and the extension
   with a 401 even with the right password. In the Vercel dashboard:
   the project, Settings, Deployment Protection, Vercel Authentication,
   Disabled, Save. The board's own password is the gate from here.

6. Check it. Open the address on the phone: a sign-in page, then the same
   roles as on the Mac. Wrong password must fail.

7. Point the Mac at it. Add to .env.local: `BOARD_URL=https://name.vercel.app`.
   Phone pings now open the hosted board. Restart the board.

8. The extension. Chrome, the extension's options: set "Online board" to
   the address and "Key" to BOARD_KEY. "Auto" then uses the Mac's board
   when it is running and the online one when it is not. If BOARD_KEY on
   the Mac's .env.local matches Vercel's, the key fills in by itself.

9. Their own domain, if they have one. `vercel domains add board.their-domain.com`,
   then a CNAME record at their DNS host: name `board`, target
   `cname.vercel-dns.com`, proxy off. If the address still fails after
   ten minutes, `vercel certs issue board.their-domain.com`.

A push to the connected GitHub repo redeploys the board. vercel.json
already gives the API routes 300 seconds, which a brief needs.

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
