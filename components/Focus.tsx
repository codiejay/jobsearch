import { useEffect, useMemo, useRef, useState } from "react";
import { where } from "./Row";
import { ago, calm, type Detail, type FocusRun, type Job, type Status } from "../lib/ui";

/* Focus: the untouched roles one at a time, best fit first. Each answer
   saves through the status route as it's given, so closing loses nothing.
   The queue is fixed when it starts, so saves never reshuffle it. */
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function Focus({
  jobs,
  run,
  setRun,
  now,
  onStatus,
  onSent,
  onClose,
}: {
  jobs: Job[];
  run: FocusRun;
  setRun: (r: FocusRun) => void;
  now: number;
  onStatus: (id: string, s: Status) => void;
  onSent: (id: string, at: number) => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const done = run.i >= run.order.length;
  const id = done ? null : run.order[run.i];
  const j = id ? byId.get(id) : undefined;

  const [screen, setScreen] = useState<"card" | "ask">("card");
  const [openedAt, setOpenedAt] = useState(0);
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);
  const [details, setDetails] = useState<Record<string, Detail | null>>({});
  const [full, setFull] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const d = id ? details[id] : undefined;
  const b = d?.brief || null;
  const byEmail = !!b && b.apply.method === "email" && !!b.apply.email;

  // This role's brief, and the next one's so it's ready when you get there.
  useEffect(() => {
    for (const k of [run.order[run.i], run.order[run.i + 1]]) {
      if (!k || k in details) continue;
      setDetails((m) => ({ ...m, [k]: null }));
      fetch(`/api/job?id=${encodeURIComponent(k)}`)
        .then((r) => (r.ok ? r.json() : { desc: "", brief: null }))
        .then((x) => setDetails((m) => ({ ...m, [k]: x })))
        .catch(() => {});
    }
  }, [run.i, run.order]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFull(false);
    setConfirming(false);
    setErr("");
    setDraft(b?.letter || "");
  }, [id, b?.letter]);

  // The note at the bottom goes after 6 seconds. No motion.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Moves on, and keeps what undo needs to put this step back.
  function step(next: FocusRun, msg: string, prev?: Status) {
    const before = run;
    const was = id;
    setRun(next);
    setScreen("card");
    setToast({
      msg,
      undo: () => {
        setRun(before);
        setScreen("card");
        setToast(null);
        if (was && prev) onStatus(was, prev);
      },
    });
  }

  function decide(k: "applied" | "skipped", msg: string) {
    if (!id || !j) return;
    const prev = j.status;
    onStatus(id, k);
    step({ ...run, i: run.i + 1, dec: { ...run.dec, [id]: { k, at: Date.now() } } }, msg, prev);
  }

  function later() {
    if (!id || !j) return;
    const name = calm(j.company);
    if (!run.deferred.includes(id)) {
      step({ ...run, i: run.i + 1, order: [...run.order, id], deferred: [...run.deferred, id] }, `${name} moved to the end.`);
    } else {
      step({ ...run, i: run.i + 1, dec: { ...run.dec, [id]: { k: "later", at: Date.now() } } }, `Left ${name} for later.`);
    }
  }

  async function apply() {
    if (!j) return;
    if (byEmail) return setConfirming(true);
    if (b?.verdict !== "you" && b?.letter) {
      try {
        await navigator.clipboard.writeText(b.letter);
      } catch {}
    }
    window.open(j.url, "_blank", "noopener");
    setOpenedAt(Date.now());
    setScreen("ask");
  }

  async function send() {
    if (!id || !j) return;
    setSending(true);
    setErr("");
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, body: draft, confirm: true }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || `failed (${r.status})`);
      onSent(id, x.at);
      // A sent email can't be unsent, so this step has no undo.
      setRun({ ...run, i: run.i + 1, dec: { ...run.dec, [id]: { k: "applied", at: x.at } } });
      setScreen("card");
      setToast({ msg: `Sent to ${x.to} at ${hhmm(x.at)}.`, undo: () => setToast(null) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const laterIds = Object.keys(run.dec).filter((k) => run.dec[k].k === "later");
  const count = (k: string) => Object.values(run.dec).filter((x) => x.k === k).length;
  const appliedNow = run.order
    .filter((k, n, a) => a.indexOf(k) === n && run.dec[k]?.k === "applied")
    .map((k) => ({ j: byId.get(k), at: run.dec[k].at }))
    .filter((x) => x.j);
  const total = new Set(run.order).size;
  const pos = Math.min(run.i + 1, run.order.length);

  // Keys: S skip, L later, Enter apply, Y / N on the question, Z undo, Esc out.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("textarea, input") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Enter on a focused button already clicks it
    if (k === "enter" && el.closest("button, a")) return;
    if (k === "escape") return onClose();
    if (k === "z" && toast) return toast.undo();
    if (done || !j || sending) return;
    if (screen === "card" && !confirming) {
      if (k === "s") decide("skipped", `Skipped ${calm(j.company)}.`);
      else if (k === "l") later();
      else if (k === "enter" && d !== null) apply();
      else return;
    } else if (screen === "ask") {
      if (k === "y") decide("applied", `Applied to ${calm(j.company)} at ${hhmm(Date.now())}.`);
      else if (k === "n") decide("skipped", `Skipped ${calm(j.company)}.`);
      else if (k === "l") later();
      else return;
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", on);
      html.style.overflow = was;
    };
  }, []);

  const verdict = b?.verdict ?? j?.verdict;
  const watch = b ? [...b.flags.map((t) => ({ t, warn: true })), ...b.gaps.map((t) => ({ t, warn: false }))].slice(0, 2) : [];

  return (
    <div className="fscrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fmodal" role="dialog" aria-modal="true" aria-label="Focus">
        <div className="ftop">
          <b>Focus</b>
          <span className="fpos">
            {done ? total : pos} of {total}
          </span>
          <span className="ftrack" aria-hidden>
            <span style={{ width: `${((done ? total : run.i) / Math.max(1, run.order.length)) * 100}%` }} />
          </span>
          <button className="fbtn quiet" onClick={onClose}>
            Exit<kbd>Esc</kbd>
          </button>
        </div>

        {!done && j && screen === "card" && (
          <>
            <div className="fbody">
              <div className="fhead">
                <div className="fmeta">
                  <div className="fline">
                    <span className={verdict === "send" ? "g" : "a"}>
                      {verdict === "send" ? "Ready to apply" : "Write yourself"}
                    </span>
                    <span>
                      {" "}
                      · {j.manual ? "Added by you" : j.source} · posted {ago(j.postedAt, now)}
                    </span>
                  </div>
                  <h3>{j.title}</h3>
                  <div className="fco">
                    {calm(j.company)} · {where(j)}
                  </div>
                </div>
                <div className="ffit">
                  <div className="num">{j.fit ?? "new"}</div>
                  <span>fit</span>
                </div>
              </div>
              {d === null || d === undefined ? (
                <div className="bones" aria-label="Loading">
                  <span className="bone" style={{ width: "92%" }} />
                  <span className="bone" style={{ width: "80%" }} />
                  <span className="bone" style={{ width: "64%" }} />
                </div>
              ) : !b ? (
                <p className="fwhy">No brief yet. Open the role on the board to write one, or skip it.</p>
              ) : (
                <>
                  <p className="fwhy">{b.verdictWhy}</p>
                  <div className="fsec">
                    <h5>You have</h5>
                    {b.matches.slice(0, 2).map((t, n) => (
                      <p key={n} className="yes">
                        {t}
                      </p>
                    ))}
                  </div>
                  <div className="fsec">
                    <h5>Watch out</h5>
                    {watch.length ? (
                      watch.map((w, n) => (
                        <p key={n} className={w.warn ? "warn" : ""}>
                          {w.t}
                        </p>
                      ))
                    ) : (
                      <p>Nothing stands out.</p>
                    )}
                  </div>
                  {b.verdict === "you" ? (
                    <div className="fsec">
                      <h5>They want</h5>
                      {b.wants.slice(0, 2).map((t, n) => (
                        <p key={n}>{t}</p>
                      ))}
                    </div>
                  ) : byEmail ? (
                    <div className="fletter">
                      <div className="flh">
                        <span>Email to {b.apply.email}, with your CV</span>
                      </div>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={7}
                        spellCheck
                        aria-label={`Email to ${b.apply.email}`}
                      />
                    </div>
                  ) : b.letter ? (
                    <div className="fletter">
                      <div className="flh">
                        <span>Cover letter</span>
                        <button onClick={() => setFull((f) => !f)}>{full ? "Show less" : "Read all"}</button>
                      </div>
                      <pre className={full ? "open" : ""}>{b.letter}</pre>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {confirming ? (
              <div className="ffoot">
                <span className="fask">Send to {b?.apply.email} from your email, with your CV attached?</span>
                <button className="fbtn" onClick={() => setConfirming(false)} disabled={sending}>
                  Cancel
                </button>
                <button className="fbtn go" onClick={send} disabled={sending || !draft.trim()}>
                  {sending ? "Sending…" : "Send"}
                </button>
                {err && <p className="ferr">{err}</p>}
              </div>
            ) : (
              <div className="ffoot">
                <button className="fbtn" onClick={() => decide("skipped", `Skipped ${calm(j.company)}.`)}>
                  Skip<kbd>S</kbd>
                </button>
                <button className="fbtn" onClick={later}>
                  Later<kbd>L</kbd>
                </button>
                <span className="fgrow" />
                <button className="fbtn go" onClick={apply} disabled={d === null || d === undefined}>
                  {byEmail ? "Send with your CV" : verdict === "you" || !b?.letter ? "Open posting" : "Copy letter and apply"}
                  <kbd>Enter</kbd>
                </button>
              </div>
            )}
          </>
        )}

        {!done && j && screen === "ask" && (
          <div className="fbody fcenter">
            <div className="fco">
              {calm(j.company)} · {j.title}
            </div>
            <h3 className="fbig">Did you apply?</h3>
            <p className="fwhy">
              The posting opened in a new tab at {hhmm(openedAt)}
              {verdict === "send" && b?.letter ? ", with your letter on the clipboard." : "."}
            </p>
            <div className="fanswers">
              <button
                className="fbtn go big"
                onClick={() => decide("applied", `Applied to ${calm(j.company)} at ${hhmm(Date.now())}.`)}
              >
                Yes, I applied<kbd>Y</kbd>
              </button>
              <button className="fbtn big" onClick={() => decide("skipped", `Skipped ${calm(j.company)}.`)}>
                No, skip it<kbd>N</kbd>
              </button>
              <button className="fbtn big" onClick={later}>
                Not yet, keep it for later<kbd>L</kbd>
              </button>
            </div>
            <a className="fagain" href={j.url} target="_blank" rel="noreferrer">
              Open the posting again
            </a>
          </div>
        )}

        {done && (
          <div className="fbody">
            <h3 className="fbig">That's the whole queue.</h3>
            <p className="fwhy">You went through {total} {total === 1 ? "role" : "roles"}.</p>
            <div className="fstats">
              <div>
                <span>Applied</span>
                <b className="num">{count("applied")}</b>
              </div>
              <div>
                <span>Skipped</span>
                <b className="num">{count("skipped")}</b>
              </div>
              <div>
                <span>For later</span>
                <b className="num">{count("later")}</b>
              </div>
            </div>
            {appliedNow.length > 0 && (
              <div className="flist">
                <h5>Applied just now</h5>
                {appliedNow.map(({ j: x, at }) => (
                  <div key={x!.id}>
                    <span>
                      {calm(x!.company)} <i>· {x!.title}</i>
                    </span>
                    <span className="num">{hhmm(at)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="fdone">
              <button className="fbtn go" onClick={onClose}>
                Back to the board
              </button>
              {laterIds.length > 0 && (
                <button
                  className="fbtn"
                  onClick={() => {
                    const dec = { ...run.dec };
                    laterIds.forEach((k) => delete dec[k]);
                    setRun({ order: laterIds, i: 0, deferred: [], dec });
                  }}
                >
                  Go through the {laterIds.length} for later
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="ftoast" role="status">
          <span>{toast.msg}</span>
          <button onClick={toast.undo}>
            Undo<kbd>Z</kbd>
          </button>
        </div>
      )}

      <style jsx>{`
        .fscrim {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(6, 6, 5, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: fade 200ms ease-out both;
        }
        .fmodal {
          width: 540px;
          max-width: 100%;
          max-height: min(620px, calc(100vh - 48px));
          display: flex;
          flex-direction: column;
          background: var(--panel);
          border: 1px solid #2a2a28;
          border-radius: 14px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }
        .ftop {
          display: flex;
          align-items: center;
          gap: 14px;
          height: 52px;
          flex-shrink: 0;
          padding: 0 14px 0 24px;
          border-bottom: 1px solid var(--line);
        }
        .ftop b {
          font-weight: 500;
        }
        .fpos {
          font-family: "Geist Mono", ui-monospace, monospace;
          font-size: 12px;
          color: var(--muted);
        }
        .ftrack {
          flex: 1;
          max-width: 110px;
          height: 3px;
          border-radius: 3px;
          background: #262624;
          overflow: hidden;
          margin-right: auto;
        }
        .ftrack span {
          display: block;
          height: 100%;
          background: var(--muted);
          transition: width 280ms var(--ease);
        }
        .fbody {
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 22px;
          padding: 22px 24px;
          scrollbar-width: thin;
          scrollbar-color: #33332f transparent;
        }
        .fbody::-webkit-scrollbar {
          width: 10px;
        }
        .fbody::-webkit-scrollbar-track {
          background: transparent;
        }
        .fbody::-webkit-scrollbar-thumb {
          background: #2e2e2b;
          border-radius: 10px;
          border: 3px solid var(--panel);
        }
        .fcenter {
          justify-content: center;
          gap: 0;
        }
        .fhead {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
        }
        .fmeta {
          min-width: 0;
        }
        .fline {
          font-size: 12.5px;
          color: var(--muted);
        }
        .fline .g {
          color: var(--green);
          font-weight: 500;
        }
        .fline .a {
          color: var(--amber);
          font-weight: 500;
        }
        h3 {
          margin: 8px 0 0;
          font-size: 20px;
          line-height: 1.25;
          font-weight: 500;
          letter-spacing: -0.01em;
        }
        .fbig {
          font-size: 24px;
          margin-top: 10px;
        }
        .fco {
          margin-top: 4px;
          font-size: 13px;
          color: var(--muted);
        }
        .ffit {
          flex-shrink: 0;
          text-align: right;
        }
        .ffit .num {
          font-size: 28px;
          font-weight: 500;
          line-height: 1;
        }
        .ffit span {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          color: var(--muted);
        }
        .fwhy {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.65;
          color: #a9a8a3;
        }
        .fcenter .fwhy {
          margin-top: 8px;
          color: #a9a8a3;
        }
        h5 {
          margin: 0 0 10px;
          font-size: 11px;
          font-weight: 400;
          color: var(--muted);
        }
        .fsec {
          display: grid;
          gap: 8px;
        }
        .fsec h5 {
          margin-bottom: 2px;
        }
        /* one point per line, a dot in front: green for what you have,
           amber for a real blocker, grey for the rest */
        .fsec p {
          position: relative;
          margin: 0;
          padding-left: 14px;
          font-size: 13px;
          line-height: 1.5;
          color: #c9c8c3;
        }
        .fsec p::before {
          content: "";
          position: absolute;
          left: 0;
          top: 8px;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--faint);
        }
        .fsec p.yes::before {
          background: var(--green);
        }
        .fsec p.warn {
          color: var(--amber);
        }
        .fsec p.warn::before {
          background: var(--amber);
        }
        .fletter {
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--bg);
        }
        .flh {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 7px 12px;
          border-bottom: 1px solid var(--line);
          font-size: 11.5px;
          color: var(--muted);
        }
        .flh button {
          border: 0;
          background: none;
          padding: 2px 4px;
          font-size: 11.5px;
          color: #a9a8a3;
        }
        .flh button:hover {
          color: var(--text);
        }
        .fletter pre {
          margin: 0;
          padding: 10px 12px;
          white-space: pre-wrap;
          font-family: inherit;
          font-size: 12.5px;
          line-height: 1.6;
          color: #d6d5d0;
          max-height: 62px;
          overflow: hidden;
        }
        .fletter pre.open {
          max-height: none;
        }
        .fletter textarea {
          display: block;
          box-sizing: border-box;
          width: 100%;
          margin: 0;
          padding: 10px 12px;
          border: 0;
          outline: none;
          resize: vertical;
          background: none;
          font: inherit;
          font-size: 12.5px;
          line-height: 1.6;
          color: #d6d5d0;
        }
        .ffoot {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          flex-shrink: 0;
          padding: 12px 24px;
          border-top: 1px solid var(--line);
        }
        .fgrow {
          flex: 1;
        }
        .fask {
          flex: 1;
          color: #a9a8a3;
          font-size: 12.5px;
        }
        .ferr {
          width: 100%;
          margin: 0;
          color: var(--amber);
          font-size: 12px;
        }
        .fbtn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 34px;
          padding: 0 11px;
          font-size: 12.5px;
          border-radius: 8px;
        }
        .fbtn.quiet {
          height: 30px;
          padding: 0 10px;
          background: none;
          color: var(--muted);
        }
        .fbtn.go {
          border: 0;
          background: var(--text);
          color: var(--bg);
          font-weight: 500;
        }
        .fbtn.go:hover {
          background: #fff;
        }
        .fbtn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .fbtn.big {
          height: 44px;
          justify-content: space-between;
          padding: 0 14px;
          font-size: 13.5px;
          border-radius: 10px;
        }
        kbd {
          font-family: "Geist Mono", ui-monospace, monospace;
          font-size: 10.5px;
          font-weight: 400;
          padding: 0 5px;
          border: 1px solid #333330;
          border-radius: 4px;
          color: var(--muted);
        }
        .go kbd {
          border-color: #b9b8b3;
          color: #55544f;
        }
        .fanswers {
          display: grid;
          gap: 8px;
          margin-top: 22px;
        }
        .fagain {
          margin-top: 16px;
          font-size: 12.5px;
          color: #a9a8a3;
          text-underline-offset: 3px;
        }
        .fstats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .fstats div {
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .fstats span {
          display: block;
          font-size: 11px;
          color: var(--muted);
        }
        .fstats b {
          font-size: 22px;
          font-weight: 500;
        }
        .flist div {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 9px 0;
          border-bottom: 1px solid #1c1c1b;
          font-size: 13px;
        }
        .flist div span:first-child {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .flist i {
          font-style: normal;
          color: var(--muted);
        }
        .flist .num {
          flex-shrink: 0;
          color: #a9a8a3;
          font-size: 12.5px;
        }
        .fdone {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
        }
        .ftoast {
          position: fixed;
          left: 50%;
          bottom: 28px;
          transform: translateX(-50%);
          z-index: 51;
          display: flex;
          align-items: center;
          gap: 14px;
          white-space: nowrap;
          background: #232321;
          border: 1px solid #333330;
          border-radius: 10px;
          padding: 8px 8px 8px 14px;
          font-size: 13px;
          color: #d6d5d0;
        }
        .ftoast button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 30px;
          padding: 0 10px;
          background: none;
          border-color: #3a3a37;
        }
        .bones {
          display: grid;
          gap: 9px;
        }
        .bone {
          display: block;
          height: 9px;
          border-radius: 4px;
          background: #1d1d1b;
        }
        @keyframes fade {
          from {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fscrim {
            animation: none;
          }
          .ftrack span {
            transition: none;
          }
        }
        /* Phones: a full-screen sheet, Apply big and in thumb reach. */
        @media (max-width: 720px) {
          .fscrim {
            padding: 0;
            align-items: stretch;
          }
          .fmodal {
            width: 100%;
            max-height: none;
            border: 0;
            border-radius: 0;
          }
          .ftop {
            padding: 0 12px 0 16px;
          }
          .fbody {
            padding: 20px 16px;
          }
          h3 {
            font-size: 22px;
          }
          .fwhy,
          .fsec p,
          .fletter pre {
            font-size: 14px;
          }
          .fletter textarea {
            font-size: 16px;
          }
          .ffoot {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            padding: 12px 16px 20px;
          }
          .ffoot .fgrow {
            display: none;
          }
          .ffoot .fbtn {
            height: 44px;
            justify-content: center;
            font-size: 14px;
          }
          .ffoot .fbtn.go {
            grid-column: 1 / -1;
            order: -1;
            height: 52px;
            font-size: 15px;
          }
          .ffoot .fask {
            grid-column: 1 / -1;
          }
          kbd {
            display: none;
          }
          .ftoast {
            bottom: 150px;
          }
        }
      `}</style>
    </div>
  );
}
