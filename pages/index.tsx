import type { GetServerSideProps } from "next";
import Head from "next/head";
import Board, { type Props } from "../components/Board";
import SignIn from "../components/SignIn";
import { allowed } from "../lib/guard";
import { getMeta, getProfile, listJobs } from "../lib/store";

/* The board. The hourly scan (scripts/scan.mjs) fills it through
   lib/store.ts. Without a session it shows only the sign-in. */

type PageProps = Props | { locked: true };

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ req, res }) => {
  res.setHeader("x-robots-tag", "noindex");
  if (!allowed(req)) return { props: { locked: true } };
  const person = await getProfile()
    .then((p) => ({ name: String(p.name || ""), firstName: String(p.firstName || "") }))
    .catch(() => ({ name: "", firstName: "" }));
  try {
    const [all, meta] = await Promise.all([listJobs(), getMeta()]);
    // strip long fields the table never shows
    const jobs = all.map(({ desc, blurb, where, brief, ...j }: any) =>
      brief ? { ...j, verdict: brief.verdict, fit: brief.fit } : j
    );
    return { props: { jobs, scannedAt: meta.scannedAt, now: Date.now(), person } };
  } catch {
    return { props: { jobs: [], scannedAt: null, now: Date.now(), person } };
  }
};

export default function Page(props: PageProps) {
  if ("locked" in props)
    return (
      <>
        <Head>
          <title>Job search</title>
        </Head>
        <SignIn />
      </>
    );
  return <Board {...props} />;
}
