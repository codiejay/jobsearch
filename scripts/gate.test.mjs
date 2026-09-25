// The verdict gate in lib/brief.ts, whatever the model said.
import "./ts-hooks.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { gate, SEND_MIN, APPLY_MIN } = await import("../lib/brief.ts");

test("send needs fit 75", () => {
  assert.equal(gate("send", SEND_MIN, "Good match.").verdict, "send");
  const g = gate("send", SEND_MIN - 1, "Good match.");
  assert.equal(g.verdict, "you");
  assert.match(g.verdictWhy, /^Fit is only 74/);
});

test("under 60 is skip even when the model said you or send", () => {
  assert.equal(gate("you", APPLY_MIN - 1, "Worth a look.").verdict, "skip");
  assert.equal(gate("send", 10, "Worth a look.").verdict, "skip");
  assert.equal(gate("you", APPLY_MIN, "Worth a look.").verdict, "you");
});

test("skip stays skip and the reason is untouched", () => {
  assert.deepEqual(gate("skip", 90, "German required."), { verdict: "skip", verdictWhy: "German required." });
});

test("gating twice does not stack the note", () => {
  const once = gate("send", 70, "Good match.");
  const twice = gate(once.verdict, 70, once.verdictWhy);
  assert.equal(twice.verdictWhy, once.verdictWhy);
});
