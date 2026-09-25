# Job search

A private job board for one person. It finds roles every hour, scores
them, writes a brief and a cover letter in your voice for the good ones,
fills application forms from a Chrome extension, and tells you about new
roles on screen when you are at the Mac and on your phone when you are
not.

Setting it up takes about half an hour. Open this folder in your coding
agent and say: "Read AGENT.md and set this up with me." It walks you
through, step by step. If you would rather do it by hand, AGENT.md is the
guide.

## What you need

- A Mac that stays on (the board runs anywhere; the on-screen part is Mac only)
- Node 22.6 or newer
- An Anthropic API key (about 6 cents per role)
- Chrome
- The ntfy app on your phone (free)

## The short version

```
npm install
node bin/jobsearch.mjs init        # your facts, written to data/
node bin/jobsearch.mjs doctor      # what is still missing
node bin/jobsearch.mjs scan --hours 24 --no-draft
node bin/jobsearch.mjs dev         # http://localhost:4750
node bin/jobsearch.mjs scan        # with briefs and letters
node bin/jobsearch.mjs schedule install
```

Then load `extension/` in Chrome (chrome://extensions, Developer mode,
Load unpacked) and run `node bin/jobsearch.mjs ping --test` for the phone.

## What makes the letters good

Three files in `data/`, and nothing else:

- `cv.txt`: the only facts the letters may use.
- `profile.json`: where you live, your timezone, whether you need a visa,
  what you want.
- `voice.md`: three to six lines of work worth telling, and one letter
  you would send. The model matches that letter's register.

The tool checks every draft for words that read as AI, retries once, and
strips dashes. A role is "Ready to apply" only when the fit is 75 or more,
enforced in code, whatever the model said.

## Layout

```
bin/jobsearch.mjs      the command
jobsearch.config.mjs   the rules: queries, places, regions, thresholds
scripts/scan.mjs       the hourly scan
scripts/score.mjs      the rule score, and the title regexes
scripts/ping.mjs       phone pings through ntfy
lib/                   store, brief, claude, auth, mail, desk, linkedin
pages/, components/    the board (Next.js)
extension/             the Chrome extension
data/                  your files, never committed
launchd/               the hourly job template
```

## Privacy

Everything runs on your machine. The CV and letters go to Anthropic to
write the brief, and nowhere else. A phone ping carries the title,
company, location and fit only. The board answers only on localhost
unless you set a password.
