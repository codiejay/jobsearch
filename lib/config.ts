import path from "node:path";
import { pathToFileURL } from "node:url";

/* jobsearch.config.mjs, read once. The scan reads the same file directly;
   this is for the Next side, which cannot import an .mjs at the root
   statically. */

export type Geo = { geoId: string; location: string; wt: string; mode: "remote" | "on-site"; region?: string };
export type Config = {
  port: number;
  linkedin: { queries: string[]; geos: Geo[] };
  regions: {
    remote: Record<string, number>;
    onSite: string[];
    onSitePoints: { home: number; sponsored: number; other: number };
  };
  keepMin: number;
  draftMin: number;
  draftMax: number;
  draftSeconds: number;
  keepDays: number;
  keepDaysHn: number;
  ntfy: { server: string; quiet: [number, number] };
  awayMinutes: number;
};

let loaded: Promise<Config> | undefined;
export function config(): Promise<Config> {
  loaded ??= import(pathToFileURL(path.join(process.cwd(), "jobsearch.config.mjs")).href).then((m) => m.default as Config);
  return loaded;
}
