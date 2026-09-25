# The Chrome extension

Sends job posts to your board, fills application forms, and shows new
roles on screen while you are at the computer.

## Load it

1. Open `chrome://extensions`.
2. Turn on Developer mode, top right.
3. Click Load unpacked and pick this folder.
4. Right-click the new extension's icon, choose Options, and check the
   Board field says `auto`. Leave Online board blank unless you host the
   board somewhere.

The board must be running (`npm run dev` in the package) for the
extension to do anything.

## What it does

- Click the icon, or press Alt+Shift+J, to send the open page to the
  board. A selection wins over the whole page. Right-click a link to send
  that link instead. The board reads the job out of it, writes the brief
  and letter, and tags it "Added by you". About half a minute.
- Right-click a form and choose Fill this application, or press
  Alt+Shift+F. It reads the fields, asks the board for answers and types
  them in. Green outline: filled. Amber outline: left for you. It never
  submits, never clicks a button except the chosen radio or checkbox, and
  never leaves the page. You check the form and send it.
- Once a minute it tells the board you are here. When the scan finds a
  role worth applying to, a notice appears top right in whatever tab you
  are on: open the board, Later (30 minutes), or Mute 1h. Nothing shows
  while a tab is sharing its screen, or while Zoom is.

## Options

- Board: `auto` uses this machine's board at `http://localhost:4750` when
  it answers, and the Online board when it doesn't. Type a URL to pin one.
- Online board: where you host the board, if you do.
- Key: `BOARD_KEY` from the board's `.env.local`. Only needed for the
  online board. Filled in by itself whenever the local board is running.
