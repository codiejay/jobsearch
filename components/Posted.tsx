import { useState } from "react";
import type { Job } from "../lib/ui";

/* Roles posted in the last 24 hours, one bar per hour. Shows when the
   fresh ones land, which is the point of scanning every hour. */
export default function Posted({ jobs, now }: { jobs: Job[]; now: number }) {
  const hours = 24;
  const counts = Array.from({ length: hours }, (_, i) => {
    const from = now - (hours - i) * 36e5;
    return jobs.filter((j) => j.postedAt > from && j.postedAt <= from + 36e5).length;
  });
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000;
  const H = 120;
  const slot = W / hours;
  const bw = slot - 6;

  return (
    <section className="panel">
      <h2>Posted in the last 24 hours</h2>
      <p className="sub">
        <span className="num">{total}</span> matching roles, by the hour they went up.
      </p>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H + 22}`} preserveAspectRatio="none" role="img" aria-label="Matching roles posted per hour">
          <line x1="0" x2={W} y1={H} y2={H} className="base" />
          {counts.map((n, i) => {
            const h = n ? Math.max(3, (n / max) * (H - 8)) : 0;
            const x = i * slot + 3;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                {h > 0 && (
                  <path
                    d={`M${x},${H} v${-(h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${h - 3} z`}
                    className={hover === i ? "bar on" : "bar"}
                  />
                )}
              </g>
            );
          })}
        </svg>
        <div className="axis">
          <span>24h ago</span>
          <span>12h ago</span>
          <span>now</span>
        </div>
        {hover !== null && (
          <div className="tip" style={{ left: `${((hover + 0.5) / hours) * 100}%` }}>
            <span className="num">{counts[hover]}</span> {counts[hover] === 1 ? "role" : "roles"},{" "}
            {hours - hover - 1 === 0 ? "this hour" : `${hours - hover - 1}h ago`}
          </div>
        )}
      </div>
      <style jsx>{`
        .chart {
          position: relative;
          margin-top: 16px;
        }
        svg {
          display: block;
          width: 100%;
          height: 130px;
        }
        .base {
          stroke: var(--line);
          stroke-width: 1;
          vector-effect: non-scaling-stroke;
        }
        .bar {
          fill: #4a4a46;
        }
        .bar.on {
          fill: var(--text);
        }
        .axis {
          display: flex;
          justify-content: space-between;
          color: var(--faint);
          font-size: 11px;
          margin-top: -14px;
        }
        .tip {
          position: absolute;
          top: -8px;
          transform: translate(-50%, -100%);
          background: #232321;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 11.5px;
          white-space: nowrap;
          pointer-events: none;
        }
      `}</style>
    </section>
  );
}
