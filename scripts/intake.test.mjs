// The intake gate: what a scan may add to the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intake } from "./intake.mjs";

const NOW = Date.parse("2026-09-26T09:00:00Z");
const key = (j) => `${j.company}|${j.title}`.toLowerCase();
const role = (id, over = {}) => ({
  id,
  title: "Frontend Engineer",
  company: `Co ${id}`,
  location: "European Union",
  mode: "remote",
  postedAt: NOW - 36e5,
  ...over,
});

test("a role you could not take from where you are stays out", () => {
  const found = [role("a"), role("b", { mode: "on-site", location: "Berlin" })];
  const r = intake(found, new Map(), key, { now: NOW });
  assert.deepEqual(r.add.map((x) => x.job.id), ["a"]);
  const loose = intake(found, new Map(), key, { now: NOW, takeableOnly: false });
  assert.deepEqual(loose.add.map((x) => x.job.id), ["a", "b"]);
});

test("only the newMax best new roles get in, and the count left out is reported", () => {
  const found = [
    role("mid"),
    role("senior", { title: "Senior Frontend Engineer" }),
    role("staff", { title: "Staff Frontend Engineer" }),
    role("lead", { title: "Frontend Lead" }),
  ];
  const r = intake(found, new Map(), key, { now: NOW, newMax: 2 });
  assert.deepEqual(r.add.map((x) => x.job.id), ["mid", "senior"]);
  assert.equal(r.skipped, 2);
});

test("a role already on the board is refreshed, never capped, never blocked", () => {
  const known = new Map([["old", { ...role("old", { mode: "on-site", location: "Berlin" }), status: "applied" }]]);
  const r = intake([role("old", { mode: "on-site", location: "Berlin" }), role("new")], known, key, { now: NOW, newMax: 0 });
  assert.equal(r.update.length, 1);
  assert.equal(r.update[0].old.status, "applied");
  assert.equal(r.add.length, 0);
  assert.equal(r.skipped, 1);
});

test("the same role from two feeds is one role", () => {
  const twice = [role("x1", { company: "Acme" }), role("x2", { company: "Acme" })];
  const r = intake(twice, new Map(), key, { now: NOW });
  assert.equal(r.add.length, 1);
});

test("under keepMin on best is dropped before the cap, so the cap counts real roles", () => {
  // Full-stack tops out at 25 fit: best 80, under the 85 bar.
  const found = [role("fs", { title: "Full Stack Engineer" }), role("ok")];
  const r = intake(found, new Map(), key, { now: NOW, newMax: 1, keepMin: 85 });
  assert.deepEqual(r.add.map((x) => x.job.id), ["ok"]);
  assert.equal(r.skipped, 0);
});

test("what does not score is dropped before the cap", () => {
  const r = intake([role("us", { location: "United States" }), role("ok")], new Map(), key, { now: NOW, newMax: 1 });
  assert.deepEqual(r.add.map((x) => x.job.id), ["ok"]);
  assert.equal(r.skipped, 0);
});
