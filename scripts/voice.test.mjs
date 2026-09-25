import "./ts-hooks.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { parseVoice, voiceRules } = await import("../lib/brief.ts");
const md = readFileSync(new URL("../data/examples/voice.md", import.meta.url), "utf8");

test("voice.md splits into material and sample", () => {
  const v = parseVoice(md);
  assert.match(v.material, /^- Built the PDF viewer/m);
  assert.match(v.sample, /^Hi Example team,/);
  assert.match(v.sample, /adaokafor\.dev$/);
});

test("the rules name the person and carry the sample", () => {
  const r = voiceRules({ name: "Ada Okafor", firstName: "Ada", website: "https://adaokafor.dev" }, md);
  assert.match(r, /If Ada wouldn't say it out loud/);
  assert.match(r, /Then "Ada Okafor" and "adaokafor\.dev" on their own lines/);
  assert.match(r, /APPROVED SAMPLE IN ADA'S VOICE/);
});

test("no voice file still gives usable rules", () => {
  const r = voiceRules({ name: "Sam Lee" }, "");
  assert.match(r, /no sample letter yet/);
  assert.doesNotMatch(r, /Good material/);
});
