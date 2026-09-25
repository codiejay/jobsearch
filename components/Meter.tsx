/* Claude's fit as a bar and a number. Before a brief exists there is
   nothing honest to show, so the track stays empty and the cell says so. */
export default function Meter({ value, ai }: { value: number; ai: boolean }) {
  const pct = Math.max(4, Math.min(100, ((value - 40) / 60) * 100));
  const tone = value >= 80 ? "hot" : value >= 65 ? "warm" : "cool";
  return (
    <span className="meter" title={ai ? `Claude's fit: ${value}` : "No brief yet, so no fit score."}>
      <span className="track" aria-hidden>
        {ai && <span className={`fill ${tone}`} style={{ width: `${pct}%` }} />}
      </span>
      <span className={`v ${ai ? "ai" : "none"}`}>{ai ? value : "no brief"}</span>
      <style jsx>{`
        .meter {
          display: inline-flex;
          align-items: center;
          gap: 9px;
        }
        .track {
          width: 34px;
          height: 3px;
          border-radius: 3px;
          background: #262624;
          overflow: hidden;
        }
        .fill {
          display: block;
          height: 100%;
          border-radius: 3px;
          transform-origin: left;
          animation: grow 700ms cubic-bezier(0.25, 1, 0.5, 1) both;
          animation-delay: calc(120ms + var(--i, 0) * 22ms);
        }
        @keyframes grow {
          from {
            transform: scaleX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fill {
            animation: none;
          }
        }
        .fill.cool {
          background: #6b6a65;
        }
        .fill.warm {
          background: var(--amber);
        }
        .fill.hot {
          background: var(--orange);
        }
        .v {
          color: var(--muted);
        }
        .v.ai {
          color: var(--text);
        }
        .v.none {
          color: var(--faint);
          font-size: 0.85em;
        }
      `}</style>
    </span>
  );
}
