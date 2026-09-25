import { useEffect, useRef, useState } from "react";

/* The list switcher: a segmented track whose highlight slides to the
   picked tab. Measured from the buttons, so labels can be any length. */
export default function Tabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string; n: number }[];
  value: string;
  onChange: (k: string) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const place = () => {
      const el = refs.current[value];
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    place();
    document.fonts?.ready.then(place);
    window.addEventListener("resize", place);
    const t = setTimeout(() => setReady(true), 50);
    return () => {
      window.removeEventListener("resize", place);
      clearTimeout(t);
    };
  }, [value, items.length]);

  return (
    <nav className="tabs" aria-label="Lists">
      {box && (
        <span
          className={`hl ${ready ? "move" : ""}`}
          style={{ transform: `translateX(${box.x}px)`, width: box.w }}
          aria-hidden
        />
      )}
      {items.map((t) => (
        <button
          key={t.key}
          ref={(el) => {
            refs.current[t.key] = el;
          }}
          className={value === t.key ? "on" : ""}
          aria-pressed={value === t.key}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          <span className="n">{t.n}</span>
        </button>
      ))}
      <style jsx>{`
        .tabs {
          position: relative;
          display: flex;
          padding: 3px;
          border: 1px solid var(--line);
          border-radius: 9px;
          background: var(--well);
          margin-left: auto;
          max-width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar {
          display: none;
        }
        .hl {
          position: absolute;
          top: 3px;
          bottom: 3px;
          left: 0;
          border-radius: 6px;
          background: #242422;
          box-shadow: inset 0 0 0 1px #2e2e2b;
        }
        .hl.move {
          transition: transform 280ms var(--ease), width 280ms var(--ease);
        }
        .tabs button {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 26px;
          padding: 0 11px;
          border: 0;
          border-radius: 6px;
          background: none;
          color: var(--muted);
          font-size: 12px;
          white-space: nowrap;
        }
        .tabs button:hover {
          color: var(--text);
        }
        .tabs button.on {
          color: var(--text);
        }
        .n {
          font-family: "Geist Mono", ui-monospace, monospace;
          font-size: 11px;
          color: var(--faint);
          transition: color 160ms;
        }
        .tabs button.on .n {
          color: var(--muted);
        }
        @media (max-width: 720px) {
          .tabs button {
            height: 32px;
            font-size: 13px;
          }
        }
      `}</style>
    </nav>
  );
}
