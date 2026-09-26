import { useEffect, useRef, useState } from "react";
import type { AiSource } from "../lib/claude";
import List from "./List";
import { AFTER, LABEL, STAGES, ago, appliedAt, day, type Brief, type Detail, type Job, type Status } from "../lib/ui";

/* Opens under the clicked row: how to apply, the description, and (next
   step) the drafted message to approve. */
const COST: Record<AiSource, string> = {
  api: "About 6 cents.",
  claude: "Uses your Claude Code plan.",
  codex: "Uses your Codex plan.",
};

export default function Drawer({
  job: j,
  now,
  ai,
  onClose,
  onStatus,
  onBrief,
  onSent,
}: {
  job: Job;
  now: number;
  ai: AiSource | null;
  onClose: () => void;
  onStatus: (s: Job["status"]) => void;
  onBrief: (b: Brief, status: Status) => void;
  onSent: (at: number) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  // the email letter as it is edited, and the send confirm below it
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [dryNote, setDryNote] = useState("");

  async function write() {
    setWriting(true);
    setErr("");
    try {
      const r = await fetch(`/api/brief?id=${encodeURIComponent(j.id)}`, { method: "POST" });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || `failed (${r.status})`);
      setD((old) => (old ? { ...old, brief: x.brief } : old));
      onBrief(x.brief, x.status);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWriting(false);
    }
  }

  const b = d?.brief || null;
  const mail = d?.sentMail || null;
  const sent = ["applied", "interview", "offer", "rejected"].includes(j.status);
  // the drawer only opens on a click, so local time is safe here
  const applied = appliedAt(j);
  const byEmail = !!b && b.apply.method === "email" && !!b.apply.email;
  const gmail = byEmail
    ? "https://mail.google.com/mail/?view=cm&fs=1&" +
      new URLSearchParams({ to: b!.apply.email, su: b!.subject, body: draft }).toString()
    : null;

  useEffect(() => {
    setDraft(b?.letter || "");
    setConfirming(false);
    setSendErr("");
    setDryNote("");
  }, [b?.letter]);

  async function sendLetter() {
    // ?dry=1 on the page builds the email and sends nothing
    const dryRun = new URLSearchParams(window.location.search).get("dry") === "1";
    setSending(true);
    setSendErr("");
    setDryNote("");
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: j.id, body: draft, confirm: true, dryRun }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || `failed (${r.status})`);
      setConfirming(false);
      if (dryRun) {
        setDryNote(`Dry run. Nothing was sent. It would go to ${x.to}.`);
        return;
      }
      setD((old) =>
        old && b ? { ...old, sentMail: { to: x.to, subject: b.subject, body: draft, at: x.at, messageId: x.messageId } } : old
      );
      onSent(x.at);
    } catch (e) {
      setSendErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function copyLetter() {
    if (!b) return;
    try {
      await navigator.clipboard.writeText(mail ? mail.body : byEmail ? draft : b.letter);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  useEffect(() => {
    setD(null);
    let live = true;
    fetch(`/api/job?id=${encodeURIComponent(j.id)}`)
      .then((r) => (r.ok ? r.json() : { desc: "", brief: null }))
      .then((x) => live && setD(x));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [j.id, onClose]);

  const how =
    j.apply === "company"
      ? "Company site. LinkedIn's Apply button sends you there."
      : j.apply === "easy"
      ? "Easy Apply only on LinkedIn. Find the role on the company's careers page instead."
      : j.source === "HN"
      ? "Read the post. Most say to email the founder or apply on their site."
      : "Open the posting to see how to apply.";

  const [full, setFull] = useState(false);
  const [answers, setAnswers] = useState(false);
  useEffect(() => {
    setFull(false);
    setAnswers(false);
  }, [j.id]);
  const written = d?.form?.answers.filter((a) => a.kind === "written") || [];

  // keep the opened row and its details in view
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [d]);

  return (
    <div className="detail" ref={box}>
      <div className="main">
        <div className="facts">
          <span>{j.manual ? "Added by you" : j.source}</span>
          <span>{ago(j.postedAt, now)}</span>
          {d?.seniority && d.seniority !== "Not Applicable" && <span>{d.seniority}</span>}
          {d?.empType && <span>{d.empType}</span>}
          <span className={j.apply === "easy" || j.lang ? "warn" : ""}>
            {how}
            {j.lang && " The posting is in another language, or asks for one."}
          </span>
        </div>
        {d?.form && (
          <div className="filled">
            Form filled {ago(d.form.filledAt, now)}. Answers saved below.
            {written.length > 0 && (
              <button className="more" onClick={() => setAnswers((o) => !o)}>
                {answers ? "Hide answers" : `Show ${written.length} written ${written.length === 1 ? "answer" : "answers"}`}
              </button>
            )}
            {answers && (
              <div className="letter">
                {written.map((a, i) => (
                  <div key={i} className="answer">
                    <div className="lhead">{a.label}</div>
                    <pre>{a.value}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {writing ? (
          <div className="working fade">
            <p>{b ? "Rewriting the letter" : "Writing the brief and letter"}. About 20 seconds.</p>
            <div className="bar">
              <span />
            </div>
            <div className="cols3">
              {[0, 1, 2].map((k) => (
                <div key={k} className="bones" style={{ marginTop: 0 }}>
                  <span className="bone" style={{ width: "40%" }} />
                  <span className="bone" style={{ width: "92%" }} />
                  <span className="bone" style={{ width: "76%" }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          d !== null &&
          !b && (
            <div className="write fade">
              <button onClick={write}>Write brief and cover letter</button>
              <span>{ai ? COST[ai] : "Needs an API key, Claude Code or Codex. Run jobsearch doctor."}</span>
              {err && <p className="err">{err}</p>}
            </div>
          )
        )}

        {b && !writing && (
          <div className="brief fade">
            {sent ? (
              // After you apply, the draft's advice is history. Say where
              // it stands instead.
              <p className={`verdict v-sent s-${j.status}`}>
                <b>
                  {LABEL[j.status]}
                  {j.status === "applied" && applied
                    ? ` ${day(applied, true)}`
                    : j.statusAt
                    ? ` ${ago(j.statusAt, Date.now())}`
                    : ""}
                  .
                </b>{" "}
                {j.status !== "applied" && applied && <>You applied {day(applied, true)}. </>}
                {AFTER[j.status as keyof typeof AFTER]}
              </p>
            ) : (
              <p className={`verdict v-${b.verdict}`}>
                <b>{b.verdict === "send" ? "Ready to apply" : b.verdict === "you" ? "Write yourself" : "Skip suggested"}</b>{" "}
                {b.verdictWhy}
              </p>
            )}
            <p className="summary">{b.summary}</p>
            <div className="cols">
              <List title="They want" items={b.wants} />
              <List title="You have" items={b.matches} />
              <List title="Gaps" items={[...b.flags, ...b.gaps]} warn={b.flags.length} />
            </div>
            {(b.letter || mail) && (
              <div className="letter">
                <div className="lhead">
                  <span>
                    {mail
                      ? `Sent to ${mail.to}, ${ago(mail.at, Date.now())}`
                      : sent
                      ? "The drafted letter"
                      : byEmail
                      ? `Email to ${b.apply.email}`
                      : "Cover letter"}
                  </span>
                  <span className="lactions">
                    <button onClick={copyLetter}>{copied ? "Copied" : "Copy"}</button>
                    {!sent && !mail && <button onClick={write}>Rewrite</button>}
                  </span>
                </div>
                {mail ? (
                  <pre>{mail.body}</pre>
                ) : byEmail && !sent ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck
                    rows={12}
                    aria-label={`Email to ${b.apply.email}`}
                  />
                ) : (
                  <pre>{b.letter}</pre>
                )}
                {!sent && !mail && (
                  <div className="approve">
                    {byEmail && confirming ? (
                      <>
                        <span className="ask">Send to {b.apply.email} from your email, with your CV attached?</span>
                        <button className="go" onClick={sendLetter} disabled={sending || !draft.trim()}>
                          {sending ? "Sending…" : "Send"}
                        </button>
                        <button className="quiet" onClick={() => setConfirming(false)} disabled={sending}>
                          Cancel
                        </button>
                      </>
                    ) : byEmail ? (
                      <>
                        <button className="go" onClick={() => setConfirming(true)} disabled={!draft.trim()}>
                          Approve and send
                        </button>
                        <a className="quiet" href={gmail!} target="_blank" rel="noreferrer">
                          Open in Gmail instead
                        </a>
                      </>
                    ) : (
                      <>
                        <a className="go" href={j.url} target="_blank" rel="noreferrer" onClick={copyLetter}>
                          Copy letter and open the application
                        </a>
                        <span>Paste it into their form, then mark it Applied.</span>
                      </>
                    )}
                    {dryNote && <p className="note">{dryNote}</p>}
                    {sendErr && <p className="err">{sendErr}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {d === null ? (
          <div className="bones" aria-label="Loading">
            <span className="bone" style={{ width: "34%", height: 28, borderRadius: 7 }} />
            <span className="bone" style={{ width: "96%" }} />
            <span className="bone" style={{ width: "88%" }} />
            <span className="bone" style={{ width: "93%" }} />
            <span className="bone" style={{ width: "61%" }} />
          </div>
        ) : d.desc ? (
          <>
            <p className={`desc fade ${full ? "open" : ""}`}>{d.desc}</p>
            <button className="more" onClick={() => setFull((f) => !f)}>
              {full ? "Show less" : "Show all"}
            </button>
          </>
        ) : (
          <p className="desc empty">No description saved. Open the posting to read it.</p>
        )}
      </div>

      <div className="actions">
        <a className="btn primary" href={j.url} target="_blank" rel="noreferrer">
          Open posting
        </a>
        {!sent && (
          <button className="skip" onClick={() => onStatus(j.status === "skipped" ? "new" : "skipped")}>
            {j.status === "skipped" ? "Unskip" : "Skip"}
          </button>
        )}
        <div className="stages" role="group" aria-label="Stage">
          {STAGES.map((st) => (
            <button
              key={st.key}
              className={j.status === st.key ? "on" : ""}
              aria-pressed={j.status === st.key}
              onClick={() => onStatus(j.status === st.key ? "new" : st.key)}
            >
              {st.label}
            </button>
          ))}
        </div>
        {!sent && j.statusAt && LABEL[j.status] && (
          <div className="since">
            {LABEL[j.status]} {ago(j.statusAt, Date.now())}
          </div>
        )}
      </div>
      <style jsx>{`
        .detail {
          animation: drop 300ms cubic-bezier(0.25, 1, 0.5, 1) both;
          display: grid;
          grid-template-columns: minmax(0, 680px) auto;
          justify-content: space-between;
          gap: 24px;
          padding: 12px 20px 18px 160px;
        }
        .facts {
          display: flex;
          flex-wrap: wrap;
          gap: 2px 12px;
          color: var(--faint);
          font-size: 12px;
        }
        .facts .warn {
          color: var(--amber);
        }
        .filled {
          margin-top: 4px;
          color: var(--faint);
          font-size: 12px;
        }
        .filled .more {
          margin-left: 8px;
        }
        .filled .letter {
          margin-top: 8px;
        }
        .answer + .answer .lhead {
          border-top: 1px solid var(--line);
        }
        .write {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 12px;
          color: var(--faint);
          font-size: 12px;
        }
        .write button {
          height: 28px;
          padding: 0 11px;
          font-size: 12px;
          border-radius: 7px;
        }
        .err {
          width: 100%;
          margin: 0;
          color: var(--amber);
        }
        .brief {
          margin-top: 12px;
        }
        .verdict {
          margin: 0;
          font-size: 12.5px;
          color: var(--muted);
        }
        .verdict b {
          font-weight: 500;
          margin-right: 4px;
        }
        .v-send b {
          color: var(--green);
        }
        .v-you b {
          color: var(--amber);
        }
        .v-sent b {
          color: var(--text);
        }
        .v-sent.s-interview b {
          color: var(--green);
        }
        .v-sent.s-offer b {
          color: var(--lemon);
        }
        .v-sent.s-rejected b {
          color: var(--faint);
        }
        .v-skip b {
          color: var(--faint);
        }
        .summary {
          margin: 6px 0 0;
          color: #bdbcb7;
          font-size: 12.5px;
          line-height: 1.6;
        }
        .cols {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-top: 14px;
        }
        .letter {
          margin-top: 16px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--bg);
        }
        .lhead {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid var(--line);
          color: var(--faint);
          font-size: 11.5px;
        }
        .lactions {
          display: flex;
          gap: 2px;
        }
        .lactions button {
          border: 0;
          background: none;
          color: var(--muted);
          font-size: 11.5px;
          padding: 2px 6px;
        }
        .lactions button:hover {
          color: var(--text);
        }
        .letter pre {
          margin: 0;
          padding: 12px 14px;
          white-space: pre-wrap;
          font-family: inherit;
          font-size: 12.5px;
          line-height: 1.65;
          color: #d6d5d0;
          max-height: 340px;
          overflow: auto;
        }
        .letter:focus-within {
          border-color: #3a3a37;
        }
        .letter textarea {
          display: block;
          box-sizing: border-box;
          width: 100%;
          field-sizing: content;
          min-height: 120px;
          max-height: 340px;
          margin: 0;
          padding: 12px 14px;
          border: 0;
          outline: none;
          background: none;
          resize: vertical;
          font-family: inherit;
          font-size: 12.5px;
          line-height: 1.65;
          color: #d6d5d0;
        }
        .approve .ask {
          color: var(--muted);
        }
        .approve .note {
          width: 100%;
          margin: 0;
        }
        .quiet {
          border: 0;
          background: none;
          padding: 0 2px;
          color: var(--muted);
          font-size: 11.5px;
          text-decoration: none;
        }
        .quiet:hover {
          color: var(--text);
        }
        button.go {
          border: 0;
          font-family: inherit;
          cursor: pointer;
        }
        .go:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .approve {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 10px 12px;
          border-top: 1px solid var(--line);
          color: var(--faint);
          font-size: 11.5px;
        }
        .go {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 11px;
          border-radius: 7px;
          background: var(--text);
          color: var(--bg);
          font-size: 12px;
          font-weight: 500;
          text-decoration: none;
        }
        .go:hover {
          background: #fff;
        }
        @media (max-width: 720px) {
          .cols {
            grid-template-columns: 1fr;
          }
        }
        .desc {
          margin: 8px 0 0;
          white-space: pre-wrap;
          color: #a9a8a3;
          font-size: 12.5px;
          line-height: 1.6;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .desc.open {
          display: block;
        }
        .desc.empty {
          color: var(--faint);
        }
        .more {
          border: 0 !important;
          background: none !important;
          padding: 4px 0 0 !important;
          color: var(--muted) !important;
          font-size: 12px !important;
        }
        .more:hover {
          color: var(--text) !important;
        }
        .draft {
          margin: 12px 0 0;
          white-space: pre-wrap;
          font-family: inherit;
          font-size: 12.5px;
          line-height: 1.6;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--well);
        }
        .actions {
          display: grid;
          grid-template-columns: auto auto;
          justify-content: end;
          align-content: start;
          gap: 8px 6px;
        }
        .stages {
          grid-column: 1 / -1;
          display: flex;
          padding: 2px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--well);
        }
        .stages button {
          flex: 1;
          height: 24px !important;
          border: 0 !important;
          background: none !important;
          color: var(--faint) !important;
          padding: 0 9px !important;
          font-size: 11.5px !important;
          border-radius: 6px !important;
        }
        .stages button:hover {
          color: var(--text) !important;
        }
        .stages button.on {
          background: #262624 !important;
          color: var(--text) !important;
        }
        .skip {
          background: none !important;
          color: var(--muted) !important;
        }
        .since {
          grid-column: 1 / -1;
          text-align: right;
          color: var(--faint);
          font-size: 11px;
        }
        @keyframes drop {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
        }
        .fade {
          animation: fade 320ms ease-out both;
        }
        @keyframes fade {
          from {
            opacity: 0;
          }
        }
        .bone {
          display: block;
          height: 9px;
          border-radius: 4px;
          background: #1d1d1b;
        }
        .bones {
          display: grid;
          gap: 9px;
          margin-top: 14px;
        }
        .working {
          margin-top: 12px;
          padding: 12px 14px 14px;
          border: 1px solid var(--line);
          border-radius: 10px;
        }
        .working p {
          margin: 0 0 12px;
          color: var(--muted);
          font-size: 12px;
        }
        .bar {
          height: 2px;
          border-radius: 2px;
          background: #1d1d1b;
          overflow: hidden;
          margin-bottom: 14px;
        }
        .bar span {
          display: block;
          height: 100%;
          background: var(--muted);
          transform-origin: left;
          animation: eta 25s cubic-bezier(0.1, 0.6, 0.3, 1) both;
        }
        @keyframes eta {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(0.95);
          }
        }
        .working .cols3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        @media (prefers-reduced-motion: reduce) {
          .detail,
          .fade,
          .bar span {
            animation: none;
          }
        }
        /* Phones: the buttons come first, right under the row, so you
           don't scroll past the letter to open the posting. */
        @media (max-width: 720px) {
          .detail {
            grid-template-columns: minmax(0, 1fr);
            gap: 16px;
            padding: 14px 16px 20px;
          }
          .actions {
            grid-row: 1;
            grid-template-columns: minmax(0, 1fr) auto;
            justify-content: stretch;
          }
          .actions > a,
          .actions > button {
            height: 40px;
            justify-content: center;
            font-size: 13.5px;
          }
          .stages button {
            height: 34px !important;
            font-size: 12.5px !important;
          }
          .since {
            text-align: left;
          }
          .summary,
          .desc {
            font-size: 14px;
          }
          .verdict {
            font-size: 13.5px;
          }
          .letter pre {
            font-size: 14.5px;
          }
          /* 16px or iOS zooms the page when you tap into it */
          .letter textarea {
            font-size: 16px;
          }
          .go,
          .write button {
            height: 36px;
            font-size: 13px;
          }
          .working .cols3 {
            grid-template-columns: 1fr;
          }
        }
        .actions > a,
        .actions > button {
          display: inline-flex;
          align-items: center;
          height: 28px;
          box-sizing: border-box;
          font-size: 12px;
          line-height: 1;
          padding: 0 11px;
          border-radius: 7px;
        }
        .btn {
          text-decoration: none;
          border: 1px solid var(--text);
        }
        .btn.primary {
          background: var(--text);
          color: var(--bg);
          font-weight: 500;
        }
        .btn.primary:hover {
          background: #fff;
        }
      `}</style>
    </div>
  );
}
