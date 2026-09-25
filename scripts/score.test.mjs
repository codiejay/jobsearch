// node --test scripts/jobsearch/*.test.mjs  (npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, region, freshness, FRESH_MAX } from "./score.mjs";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const h = (n) => NOW - n * 36e5;
const role = (over = {}) => ({
  title: "Frontend Engineer",
  company: "Acme",
  location: "European Union",
  mode: "remote",
  postedAt: h(0.5),
  ...over,
});

test("a fresh mid-level remote EU frontend role scores 100 and is best 100", () => {
  const s = score(role(), NOW);
  assert.equal(s.score, 100);
  assert.equal(s.best, 100);
  assert.equal(s.region, "EU");
  assert.equal(s.takeable, true);
});

test("freshness only orders: an old posting keeps its best", () => {
  const old = score(role({ postedAt: h(24 * 20) }), NOW);
  assert.equal(old.fresh, 0);
  assert.equal(old.score, 85);
  assert.equal(old.best, 100);
});

test("a senior remote role from a slow feed still clears the 85 bar on best", () => {
  const s = score(role({ title: "Senior Frontend Engineer", postedAt: h(24 * 5) }), NOW);
  assert.equal(s.score, 81 + 2);
  assert.equal(s.best, 81 + FRESH_MAX);
});

test("US and Americas roles are out", () => {
  assert.equal(score(role({ location: "United States" }), NOW), null);
  assert.equal(score(role({ title: "Frontend Engineer (US only)" }), NOW), null);
});

test("India and the rest of Asia are out, even when the card says remote", () => {
  assert.equal(score(role({ location: "Bengaluru, Karnataka, India" }), NOW), null);
  assert.equal(score(role({ location: "Sydney, Australia" }), NOW), null);
  assert.equal(region({ location: "Gurgaon, Haryana, India" }), "FAR");
});

test("Nigeria is not out: the defaults are for someone who lives there", () => {
  assert.equal(region({ location: "Lagos, Nigeria" }), "?");
  assert.ok(score(role({ location: "Lagos, Nigeria" }), NOW));
});

test("an unknown location scores under the UK", () => {
  const unknown = score(role({ location: "Somewhere" }), NOW);
  const uk = score(role({ location: "London, United Kingdom" }), NOW);
  const eu = score(role(), NOW);
  assert.ok(unknown.score < uk.score && uk.score < eu.score);
});

test("titles that are not his job return null", () => {
  for (const title of [
    "Backend Engineer (TypeScript)",
    "React Native Developer",
    "Engineering Manager",
    "WordPress Developer",
    "Frontend Intern",
    "Senior Mechanical Design Engineer",
  ])
    assert.equal(score(role({ title }), NOW), null, title);
});

test("a design engineer title with no description stays under the bar", () => {
  assert.ok(score(role({ title: "Senior Design Engineer, Luggage Compartments" }), NOW).best < 85);
});

test("angular or vue without react, and full-stack, cannot reach the board on the title", () => {
  const ng = score(role({ title: "Angular Developer" }), NOW);
  const fs = score(role({ title: "Full Stack Developer" }), NOW);
  assert.ok(ng.best < 85);
  assert.ok(fs.best < 85);
  assert.ok(score(role({ title: "Senior React/Angular Engineer" }), NOW).best >= 85);
});

test("product engineer needs a software description", () => {
  // Title alone sits exactly on the bar; the LinkedIn lookup settles it.
  assert.equal(score(role({ title: "Product Engineer" }), NOW).best, 85);
  assert.equal(score(role({ title: "Product Engineer", desc: "Design steering columns for cars." }), NOW), null);
  assert.equal(score(role({ title: "Product Engineer", desc: "Ship a React and TypeScript web app." }), NOW).best, 100);
});

test("another language costs 20, easy apply costs 15", () => {
  assert.equal(score(role({ title: "Développeur Frontend" }), NOW).score, 80);
  assert.equal(score(role({ desc: "Fluent German is required." }), NOW).lang, true);
  assert.equal(score(role({ apply: "easy" }), NOW).score, 85);
});

test("on-site outside Portugal is takeable only with sponsorship", () => {
  const berlin = role({ location: "Berlin, Germany", mode: "on-site" });
  assert.equal(score(berlin, NOW).takeable, false);
  assert.equal(score({ ...berlin, desc: "We offer visa sponsorship and relocation support." }, NOW).takeable, true);
  assert.equal(score({ ...berlin, desc: "We cannot offer visa sponsorship." }, NOW).takeable, false);
  assert.equal(score(role({ location: "Lisbon, Portugal", mode: "on-site" }), NOW).takeable, true);
});

test("freshness steps down over ten days", () => {
  assert.deepEqual([0.5, 3, 12, 48, 120, 300].map((n) => freshness(h(n), NOW)), [15, 12, 9, 5, 2, 0]);
});
