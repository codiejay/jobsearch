export default function List({ title, items, warn = 0 }: { title: string; items: string[]; warn?: number }) {
  return (
    <div>
      <h5>{title}</h5>
      {items.length ? (
        <ul>
          {items.map((t, i) => (
            <li key={i} className={i < warn ? "warn" : ""}>
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p>None</p>
      )}
      <style jsx>{`
        h5 {
          margin: 0 0 6px;
          font-size: 11px;
          font-weight: 400;
          color: var(--faint);
        }
        ul {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 5px;
        }
        li,
        p {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--muted);
        }
        li.warn {
          color: var(--amber);
        }
        @media (max-width: 720px) {
          li,
          p {
            font-size: 13.5px;
          }
        }
      `}</style>
    </div>
  );
}
