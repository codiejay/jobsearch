import type { CSSProperties } from "react";
import Meter from "./Meter";
import { REGION_NAME, ago, appliedAt, band, calm, heat, place, stage, stamp, type Job } from "../lib/ui";

// Remote roles read "Remote, EU"; on-site ones show the city.
export function where(j: Job) {
  if (j.mode === "remote") {
    const r = REGION_NAME[j.region];
    return <span className="rm">{r ? `Remote, ${r}` : "Remote"}</span>;
  }
  return place(j.location);
}

/* One role in the table. Click opens the drawer under it. */
export default function Row({
  j,
  i,
  picked,
  open,
  mounted,
  now,
  onOpen,
  onToggle,
}: {
  j: Job;
  i: number;
  picked: boolean;
  open: boolean;
  mounted: boolean;
  now: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <tr
      className={`${j.status === "skipped" ? "dim" : ""} ${
        picked || open ? "on" : ""
      }`}
      onClick={onOpen}
      aria-expanded={open}
      style={{ "--i": Math.min(i, 14) } as CSSProperties}
    >
      <td className={`sc ${j.fit != null ? band(j.fit) : "lo"}`}>
        <span className="scw">
        <span className="pick" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Pick ${j.title}`}
            checked={picked}
            onChange={onToggle}
          />
        </span>
        <Meter value={heat(j)} ai={j.fit != null} />
        </span>
      </td>
      <td className="role">
        <span className="t" title={j.title}>
          {j.title}
        </span>
        {j.manual && <span className="flag mine">Added by you</span>}
        {j.apply === "easy" && <span className="flag">Easy Apply</span>}
        {j.lang && <span className="flag">Other language</span>}
      </td>
      <td className="co">{calm(j.company)}</td>
      <td className="loc" title={j.location}>
        {where(j)}
      </td>
      <td className={`stc s-${stage(j).key}`}>
        {stage(j).label}
        {mounted && j.status === "applied" && appliedAt(j) && (
          <span className="when"> {stamp(appliedAt(j)!)}</span>
        )}
      </td>
      <td className="age">
        {ago(j.postedAt, now).replace(" ago", "")}
      </td>
    </tr>
  );
}
