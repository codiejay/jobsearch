import Head from "next/head";
import { Fragment, useCallback, useState } from "react";
import Drawer from "./Drawer";
import Focus from "./Focus";
import Posted from "./Posted";
import Row from "./Row";
import Tabs from "./Tabs";
import { OUT, VIEWS, ago, appliedAt, focusQueue, useMounted, type FocusRun, type Job, type Person, rank } from "../lib/ui";

// now: the server's clock, so "5h ago" renders the same on both sides.
export type Props = { jobs: Job[]; scannedAt: number | null; now: number; person: Person };

export default function Board({ jobs: initial, scannedAt, now, person }: Props) {
  const [jobs, setJobs] = useState(initial);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Open on the first list with something to do.
  const [view, setView] = useState(
    () => ["send", "you"].find((k) => initial.some(VIEWS.find((v) => v.key === k)!.test)) || "all"
  );
  const current = VIEWS.find((v) => v.key === view)!;
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const mounted = useMounted();
  // the focus run: kept while the page is open, so Exit then Resume picks up
  const [run, setRun] = useState<FocusRun | null>(null);
  const [focusing, setFocusing] = useState(false);
  const queue = focusQueue(jobs);
  const midway = !!run && run.i > 0 && run.i < run.order.length;

  const shown = jobs.filter((j) => {
    if (!current.test(j)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return `${j.title} ${j.company} ${j.location} ${j.source}`.toLowerCase().includes(q);
  }).sort(rank);

  const fresh = jobs.filter((j) => now - j.postedAt < 36e5 * 6).length;
  const remote = jobs.filter((j) => j.mode === "remote").length;
  const applied = jobs.filter((j) => ["applied", "interview", "offer", "rejected"].includes(j.status)).length;
  const interviews = jobs.filter((j) => j.status === "interview" || j.status === "offer").length;

  // Sets status on the picked rows, or on one row from the side panel.
  async function setStatus(status: Job["status"], only?: string) {
    const ids = only ? [only] : Array.from(picked);
    const hit = new Set(ids);
    const at = Date.now();
    setJobs((js) =>
      js.map((j) =>
        hit.has(j.id)
          ? {
              ...j,
              status,
              statusAt: at,
              appliedAt: OUT.includes(status) ? j.appliedAt ?? appliedAt(j) ?? at : undefined,
            }
          : j
      )
    );
    if (!only) setPicked(new Set());
    await fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
  }

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div className="js">
      <Head>
        <title>Job search</title>
      </Head>
      <main>
        <section className="panel stats">
          <div>
            <h1>Job search</h1>
            <p className="sub">
              {person.name ? `${person.name}'s board. ` : "No profile yet. Run: jobsearch init. "}
              {scannedAt ? `Last scan ${ago(scannedAt, now)}.` : "No scan yet."}
            </p>
          </div>
          <dl>
            <div>
              <dt>Matches</dt>
              <dd>{jobs.filter(VIEWS.find((v) => v.key === "all")!.test).length}</dd>
            </div>
            <div>
              <dt>Last 6h</dt>
              <dd>{fresh}</dd>
            </div>
            <div>
              <dt>Remote</dt>
              <dd>{remote}</dd>
            </div>
            <div>
              <dt>Applied</dt>
              <dd>{applied}</dd>
            </div>
            <div>
              <dt>Interviews</dt>
              <dd>{interviews}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <header className="head">
            <div className="lede" key={view}>
              <h2>
                {current.label} <span className="num">{shown.length}</span>
              </h2>
              <p className="sub">{current.line}</p>
            </div>
            <Tabs
              items={VIEWS.filter((v) => v.key !== "skipped" || v.key === view || jobs.some(v.test)).map((v) => ({
                key: v.key,
                label: v.label,
                n: jobs.filter(v.test).length,
              }))}
              value={view}
              onChange={(k) => {
                setView(k);
                setOpenId(null);
              }}
            />
            <div className="tools">
              {(midway || queue.length > 0) && (
                <button
                  className="focus"
                  onClick={() => {
                    if (!midway) setRun({ order: queue, i: 0, deferred: [], dec: {} });
                    setOpenId(null);
                    setFocusing(true);
                  }}
                >
                  {midway ? "Resume focus" : "Start focus"}
                  <span className="num">{midway ? `${run!.i + 1} of ${run!.order.length}` : queue.length}</span>
                </button>
              )}
              {picked.size > 0 && (
                <div className="bulk">
                  <span>{picked.size} picked</span>
                  <button onClick={() => setStatus("applied")}>Applied</button>
                  <button onClick={() => setStatus("rejected")}>Rejected</button>
                  <button onClick={() => setStatus("skipped")}>Skip</button>
                  <button onClick={() => setStatus("new")}>Reset</button>
                </div>
              )}
              {searching && (
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter roles"
                  onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setSearching(false))}
                />
              )}
              <button className="icon" aria-label="Search" onClick={() => setSearching((s) => !s)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>
            </div>
          </header>

          <div className="table">
            <table className={`v-${view}`}>
              <thead>
                <tr>
                  <th className="sc">Score</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th className="stc">Status</th>
                  <th className="age">Posted</th>
                </tr>
              </thead>
              <tbody key={view}>
                {shown.length === 0 && (
                  <tr className="none">
                    <td colSpan={6}>Nothing here yet.</td>
                  </tr>
                )}
                {shown.map((j, i) => (
                  <Fragment key={j.id}>
                    <Row
                      j={j}
                      i={i}
                      picked={picked.has(j.id)}
                      open={openId === j.id}
                      mounted={mounted}
                      now={now}
                      onOpen={() => setOpenId(openId === j.id ? null : j.id)}
                      onToggle={() => toggle(j.id)}
                    />
                  {openId === j.id && (
                    <tr className="xrow">
                      <td colSpan={6}>
                        <Drawer
                          job={j}
                          now={now}
                          onClose={close}
                          onStatus={(st) => setStatus(st, j.id)}
                          onSent={(at) =>
                            setJobs((js) =>
                              js.map((x) =>
                                x.id === j.id ? { ...x, status: "applied", statusAt: at, appliedAt: x.appliedAt ?? at } : x
                              )
                            )
                          }
                          onBrief={(b, st) =>
                            setJobs((js) =>
                              js.map((x) => (x.id === j.id ? { ...x, verdict: b.verdict, fit: b.fit, status: st } : x))
                            )
                          }
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Posted jobs={jobs} now={now} />
      </main>

      {focusing && run && (
        <Focus
          jobs={jobs}
          run={run}
          setRun={setRun}
          now={now}
          onStatus={(id, st) => setStatus(st, id)}
          onSent={(id, at) =>
            setJobs((js) =>
              js.map((x) => (x.id === id ? { ...x, status: "applied", statusAt: at, appliedAt: x.appliedAt ?? at } : x))
            )
          }
          onClose={() => setFocusing(false)}
        />
      )}

      <style jsx global>{`
        .js main {
          max-width: 1180px;
          margin: 0 auto;
          padding: 28px 16px 64px;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 16px;
        }
        .js .num {
          font-family: "Geist Mono", ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .js .panel {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 18px 20px 20px;
        }
        .js h1,
        .js h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 500;
        }
        .js .sub {
          margin: 3px 0 0;
          color: var(--muted);
          font-size: 12.5px;
        }
        .js .stats {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .js dl {
          display: flex;
          gap: 28px;
          margin: 0;
        }
        .js dt {
          color: var(--faint);
          font-size: 11px;
        }
        .js dd {
          margin: 2px 0 0;
          font-size: 18px;
          font-weight: 500;
          font-family: "Geist Mono", ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .js .head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .js .tools {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .js button {
          font: inherit;
          font-size: 12px;
          color: var(--text);
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 7px;
          padding: 5px 10px;
          cursor: pointer;
        }
        .js button:hover {
          border-color: #3a3a37;
        }
        .js button.ghost {
          background: none;
          color: var(--muted);
        }
        .js button.focus {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 30px;
          padding: 0 11px;
          border: 0;
          background: var(--text);
          color: var(--bg);
          font-weight: 500;
          white-space: nowrap;
        }
        .js button.focus:hover {
          background: #fff;
        }
        .js button.focus .num {
          font-size: 11.5px;
          font-weight: 400;
          color: #55544f;
        }
        .js button.icon {
          width: 30px;
          height: 30px;
          padding: 0;
          display: grid;
          place-items: center;
          color: var(--muted);
          background: none;
        }
        .js .bulk {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--muted);
          font-size: 12px;
          margin-right: 6px;
        }
        .js .tools input:not([type]) {
          font: inherit;
          font-size: 12px;
          color: var(--text);
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 7px;
          padding: 5px 10px;
          width: 180px;
          outline: none;
        }
        .js .table {
          margin: 0 -20px -20px;
          overflow-x: auto;
          border-top: 1px solid var(--line);
          scrollbar-width: thin;
          scrollbar-color: #2e2e2b transparent;
        }
        .js .table::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .js .table::-webkit-scrollbar-track {
          background: transparent;
        }
        .js .table::-webkit-scrollbar-thumb {
          background: #2a2a28;
          border-radius: 10px;
          border: 3px solid var(--panel);
        }
        .js .table::-webkit-scrollbar-thumb:hover {
          background: #3a3a37;
        }
        .js table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          min-width: 820px;
        }
        .js th {
          position: sticky;
          top: 0;
          background: var(--panel);
          text-align: left;
          font-size: 11px;
          font-weight: 400;
          color: var(--faint);
          padding: 10px 12px;
          border-bottom: 1px solid var(--line);
          z-index: 1;
        }
        .js td {
          padding: 0 12px;
          height: 38px;
          border-bottom: 1px solid #1c1c1b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .js tr:last-child td {
          border-bottom: 0;
        }
        .js tbody tr:hover td,
        .js tbody tr.on td {
          background: #1a1a18;
        }
        .js tr.dim td {
          opacity: 0.4;
        }
        .js .sc {
          width: 116px;
          padding-left: 20px;
        }
        .js td.sc {
          font-family: "Geist Mono", ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .js td.sc.hi {
          color: var(--text);
        }
        .js td.sc.mid {
          color: var(--muted);
        }
        .js td.sc.lo {
          color: var(--faint);
        }
        .js .scw {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .js .pick {
          display: flex;
        }
        .js input[type="checkbox"] {
          appearance: none;
          width: 13px;
          height: 13px;
          border: 1px solid #3a3a37;
          border-radius: 3px;
          margin: 0;
          cursor: pointer;
          display: grid;
          place-items: center;
          opacity: 0.35;
        }
        .js tr:hover input[type="checkbox"],
        .js input[type="checkbox"]:checked,
        .js input[type="checkbox"]:focus-visible {
          opacity: 1;
        }
        .js input[type="checkbox"]:checked {
          background: var(--text);
          border-color: var(--text);
        }
        .js input[type="checkbox"]:checked::after {
          content: "";
          width: 3px;
          height: 7px;
          border: solid var(--bg);
          border-width: 0 1.5px 1.5px 0;
          transform: translateY(-1px) rotate(45deg);
        }
        .js th:nth-child(2) {
          width: 40%;
        }
        .js .role a {
          color: var(--text);
          text-decoration: none;
        }
        .js .role a:hover {
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-color: var(--faint);
        }
        .js .flag.ok {
          color: var(--green);
        }
        /* Roles sent in from the extension get the one filled tag in the table, in
           a blue no status uses, so they stand out from the scan's finds. */
        .js .flag.mine {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 5px;
          background: rgba(122, 162, 247, 0.14);
          box-shadow: inset 0 0 0 1px rgba(122, 162, 247, 0.28);
          color: #9db7f5;
          font-weight: 500;
          line-height: 17px;
        }
        .js .flag.dim {
          color: var(--faint);
        }
        .js .flag {
          margin-left: 10px;
          font-size: 11px;
          color: var(--amber);
        }
        .js .stc {
          width: 124px;
        }
        .js td.stc {
          font-size: 12px;
          color: var(--muted);
        }
        .js .stc.s-send {
          color: var(--green);
        }
        .js .stc.s-you {
          color: var(--amber);
        }
        .js .stc.s-new,
        .js .stc.s-skip {
          color: var(--faint);
        }
        .js .stc.s-applied {
          color: var(--text);
        }
        .js .stc .when {
          color: var(--muted);
        }
        .js .stc.s-interview {
          color: var(--green);
        }
        .js .stc.s-offer {
          color: var(--lemon);
        }
        .js .stc.s-rejected,
        .js .stc.s-skipped {
          color: var(--faint);
        }
        .js .head {
          align-items: flex-start;
        }
        .js h2 .num {
          margin-left: 4px;
          color: var(--faint);
          font-size: 12px;
          font-weight: 400;
        }
        .js .lede {
          animation: rise 360ms var(--ease) both;
        }
        .js tbody tr:not(.xrow) {
          animation: rise 420ms var(--ease) both;
          animation-delay: calc(var(--i, 0) * 22ms);
        }
        .js tr.none td {
          height: 88px;
          text-align: center;
          color: var(--faint);
          cursor: default;
        }
        .js tbody tr.none:hover td {
          background: none;
        }
        .js button {
          transition: border-color 160ms, color 160ms, background-color 160ms, transform 100ms;
        }
        .js button:active {
          transform: scale(0.97);
        }
        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .js *,
          .js *::before,
          .js *::after {
            animation: none !important;
            transition: none !important;
          }
        }
        .js .co,
        .js .loc {
          color: var(--muted);
        }
        .js .rm {
          color: var(--green);
        }
        .js .age {
          width: 84px;
          text-align: right;
          padding-right: 20px;
          font-family: "Geist Mono", ui-monospace, monospace;
          font-size: 12px;
          color: var(--faint);
        }
        .js th.age {
          font-family: inherit;
          font-size: 11px;
        }
        .js tbody tr {
          cursor: pointer;
        }
        .js tbody tr.xrow {
          cursor: default;
        }
        .js tbody tr.xrow td,
        .js tbody tr.xrow:hover td {
          height: auto;
          padding: 0;
          white-space: normal;
          overflow: visible;
          background: #121211;
          border-bottom: 1px solid var(--line);
        }
        .js .role .t {
          color: var(--text);
        }
        /* Phones: the table turns into a list. Each role is two lines, the
           title and score on top, company, place and age under it. */
        @media (max-width: 720px) {
          .js main {
            padding: 16px 12px 48px;
            gap: 12px;
          }
          .js .panel {
            padding: 16px;
          }
          .js .stats {
            display: grid;
            gap: 16px;
          }
          .js dl {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px;
          }
          .js dd {
            font-size: 16px;
          }
          .js .head {
            flex-wrap: wrap;
            gap: 12px;
          }
          .js .lede {
            flex: 1 1 0;
            min-width: 0;
          }
          .js .head > nav {
            order: 3;
            flex: 1 0 100%;
            margin-left: 0;
          }
          .js .tools:has(input:not([type])) {
            order: 4;
            flex: 1 0 100%;
          }
          .js .tools input:not([type]) {
            flex: 1;
            width: auto;
            font-size: 16px;
          }
          .js .bulk,
          .js .pick {
            display: none;
          }
          .js .table {
            margin: 0 -16px -16px;
            overflow: visible;
          }
          .js table,
          .js tbody,
          .js tbody tr.xrow,
          .js tbody tr.xrow td,
          .js tr.none,
          .js tr.none td {
            display: block;
            min-width: 0;
          }
          .js thead {
            display: none;
          }
          /* Two lines per role. The title spans the left, the score sits
             right of it and the age right under the score, like an inbox. */
          .js tbody tr:not(.xrow):not(.none) {
            display: grid;
            grid-template-columns: minmax(0, auto) minmax(0, auto) minmax(0, auto) 1fr auto;
            align-items: baseline;
            row-gap: 4px;
            padding: 13px 16px;
            border-bottom: 1px solid #1c1c1b;
          }
          .js tbody tr:last-child {
            border-bottom: 0;
          }
          .js td,
          .js tbody tr:hover td,
          .js tbody tr.on td {
            display: block;
            height: auto;
            padding: 0;
            border: 0;
            background: none;
          }
          .js tbody tr.on {
            background: #1a1a18;
          }
          .js td.role {
            grid-area: 1 / 1 / 2 / 5;
            white-space: normal;
          }
          .js .role .t {
            display: block;
            font-size: 14.5px;
            line-height: 1.35;
          }
          .js .flag {
            display: inline-block;
            margin: 5px 8px 1px 0;
          }
          .js td.sc {
            grid-area: 1 / 5;
            width: auto;
            padding-left: 14px;
          }
          .js td.co,
          .js td.loc,
          .js td.stc,
          .js td.age {
            grid-row: 2;
            width: auto;
            font-size: 12.5px;
            text-align: left;
          }
          .js td.co {
            grid-column: 1;
          }
          .js td.loc {
            grid-column: 2;
          }
          .js td.stc {
            grid-column: 3;
          }
          .js td.age {
            grid-column: 5;
            text-align: right;
            padding: 0;
          }
          .js td.loc::before,
          .js td.stc::before {
            content: "·";
            margin: 0 8px;
            color: var(--faint);
          }
          /* In these two tabs every row has the tab's own status. */
          .js table.v-send td.stc,
          .js table.v-you td.stc {
            display: none;
          }
          .js tbody tr.xrow td,
          .js tbody tr.xrow:hover td {
            border-bottom: 1px solid var(--line);
          }
          .js tr.none td {
            padding: 32px 16px;
            height: auto;
          }
        }
      `}</style>
    </div>
  );
}
