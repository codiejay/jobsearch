#!/usr/bin/env node
// The one command. Run from the package folder.
//
//   jobsearch init              set up data/ by answering questions
//   jobsearch doctor            check keys, files and the board
//   jobsearch dev               run the board (next dev) on the config port
//   jobsearch start             run the built board (after: npm run build)
//   jobsearch scan [...]        one scan now; flags pass through to scan.mjs
//   jobsearch ping --test       one test ping to the phone
//   jobsearch schedule install  run the scan every hour (macOS launchd)
//   jobsearch schedule remove
//   jobsearch schedule status

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const { loadEnv } = await import("../scripts/env.mjs");
loadEnv();
const config = (await import("../jobsearch.config.mjs")).default;
const DATA = path.join(ROOT, "data");
const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

const [cmd = "help", ...rest] = process.argv.slice(2);
const run = (file, args = [], env = {}) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [...NODE_FLAGS, file, ...args], { stdio: "inherit", env: { ...process.env, ...env } });
    p.on("exit", (code) => resolve(code ?? 1));
  });
const nextBin = path.join(ROOT, "node_modules", ".bin", "next");

const commands = {
  async help() {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  },

  async init() {
    mkdirSync(DATA, { recursive: true });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (q, d = "") => ((await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim() || d);
    const yes = async (q, d = true) => /^y/i.test(await ask(`${q} (y/n)`, d ? "y" : "n"));
    console.log("\nThis writes data/profile.json. Blank answers stay blank; forms leave those fields for you.\n");
    const example = JSON.parse(readFileSync(path.join(DATA, "examples", "profile.json"), "utf8"));
    const had = existsSync(path.join(DATA, "profile.json")) ? JSON.parse(readFileSync(path.join(DATA, "profile.json"), "utf8")) : {};
    const p = { ...example, ...had };
    p.name = await ask("Full name", had.name || "");
    p.firstName = p.name.split(" ")[0];
    p.lastName = p.name.split(" ").slice(1).join(" ");
    p.email = await ask("Email", had.email || "");
    p.phone = await ask("Phone (blank is fine)", had.phone || "");
    p.linkedin = await ask("LinkedIn URL", had.linkedin || "");
    p.github = await ask("GitHub URL", had.github || "");
    p.website = await ask("Website", had.website || "");
    p.x = await ask("X or Twitter URL (blank is fine)", had.x || "");
    p.location = await ask("Where you live, city and country", had.location || "");
    p.homeCountry = await ask("Home country", had.homeCountry || p.location.split(",").pop().trim());
    p.timezone = await ask("Timezone, as you'd write it in a letter", had.timezone || "");
    p.relocation = await ask("Relocation, one line (where you can move, what visa you'd need)", had.relocation || "");
    p.needsSponsorship = await yes("Do you need visa sponsorship to work in your target regions", had.needsSponsorship ?? true);
    p.yearsExperience = Number(await ask("Years of experience", String(had.yearsExperience || "")));
    p.wants = await ask("What you want, one line", had.wants || example.wants);
    p.noticePeriod = had.noticePeriod || "";
    p.salaryExpectation = had.salaryExpectation || "";
    p.cvFile = "cv.pdf";
    writeFileSync(path.join(DATA, "profile.json"), JSON.stringify(p, null, 1) + "\n");
    console.log("wrote data/profile.json");

    for (const [file, what] of [
      ["cv.txt", "Paste your CV as plain text into it. It is the only source of facts the drafts may use."],
      ["voice.md", "Fill in what is worth telling about you, and one letter you would send."],
    ]) {
      const to = path.join(DATA, file);
      if (!existsSync(to)) {
        copyFileSync(path.join(DATA, "examples", file), to);
        console.log(`copied data/examples/${file} to data/${file}. ${what}`);
      }
    }
    if (!existsSync(path.join(DATA, "cv.pdf"))) console.log("put your CV PDF at data/cv.pdf. It is attached when a letter is sent by email.");
    if (!existsSync(path.join(ROOT, ".env.local"))) {
      copyFileSync(path.join(ROOT, ".env.example"), path.join(ROOT, ".env.local"));
      console.log("copied .env.example to .env.local. Add your ANTHROPIC_API_KEY there.");
    }
    rl.close();
    console.log("\nNext: jobsearch doctor");
  },

  async doctor() {
    let bad = 0;
    const ok = (label, good, fix) => {
      console.log(`${good ? "ok  " : "MISSING"} ${label}${good ? "" : `: ${fix}`}`);
      if (!good) bad++;
    };
    ok("node 22.6 or newer", Number(process.versions.node.split(".")[0]) >= 22, `you have ${process.versions.node}`);
    ok("node_modules", existsSync(path.join(ROOT, "node_modules")), "run: npm install");
    ok(".env.local", existsSync(path.join(ROOT, ".env.local")), "copy .env.example to .env.local");
    ok("ANTHROPIC_API_KEY", !!process.env.ANTHROPIC_API_KEY, "add it to .env.local (drafts and form answers need it)");
    ok("data/profile.json", existsSync(path.join(DATA, "profile.json")), "run: jobsearch init");
    const cv = path.join(DATA, "cv.txt");
    ok("data/cv.txt is yours", existsSync(cv) && !readFileSync(cv, "utf8").includes("Ada Okafor"), "paste your CV as plain text into data/cv.txt");
    const voice = path.join(DATA, "voice.md");
    ok("data/voice.md is yours", existsSync(voice) && !readFileSync(voice, "utf8").includes("Ada Okafor"), "fill in data/voice.md, the letters sound like the sample in it");
    ok("data/cv.pdf", existsSync(path.join(DATA, "cv.pdf")), "needed only to send letters by email or fill a resume upload");
    console.log(`info SMTP ${process.env.SMTP_USER ? "set" : "not set (letters can't be sent from the board, copy them instead)"}`);
    console.log(`info store ${process.env.JOBSEARCH_STORE === "redis" ? "redis" : "data/board.json"}`);
    console.log(`info phone pings ${existsSync(path.join(DATA, "notify.json")) ? "topic " + JSON.parse(readFileSync(path.join(DATA, "notify.json"), "utf8")).topic : "no topic yet, run: jobsearch ping --test"}`);
    console.log(`info desk checks ${process.platform === "darwin" ? "on (macOS)" : "off (not macOS): everything goes to the phone"}`);
    try {
      const r = await fetch(`http://localhost:${config.port}/api/extension`, { signal: AbortSignal.timeout(1500) });
      console.log(`info board ${r.ok ? "running" : "answered " + r.status} on http://localhost:${config.port}`);
    } catch {
      console.log(`info board not running. Start it: jobsearch dev`);
    }
    console.log(bad ? `\n${bad} thing${bad > 1 ? "s" : ""} to fix.` : "\nAll good.");
    process.exitCode = bad ? 1 : 0;
  },

  async dev() {
    if (!existsSync(nextBin)) return console.error("run: npm install");
    const p = spawn(nextBin, ["dev", "-p", String(config.port)], { stdio: "inherit" });
    p.on("exit", (c) => process.exit(c ?? 0));
  },

  async start() {
    if (!existsSync(nextBin)) return console.error("run: npm install");
    const p = spawn(nextBin, ["start", "-p", String(config.port)], { stdio: "inherit" });
    p.on("exit", (c) => process.exit(c ?? 0));
  },

  async scan() {
    process.exitCode = await run("scripts/scan.mjs", rest);
  },

  async ping() {
    process.exitCode = await run("scripts/ping.mjs", rest.length ? rest : ["--test"]);
  },

  async schedule() {
    const [what = "status"] = rest;
    if (process.platform !== "darwin") return console.log("Not macOS. Add a cron line instead, see README.md.");
    const label = "jobsearch.scan";
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
    const log = path.join(os.homedir(), "Library", "Logs", "jobsearch-scan.log");
    const target = `gui/${process.getuid()}`;
    const ctl = (...a) => execFileSync("launchctl", a, { stdio: ["ignore", "pipe", "pipe"] }).toString();
    if (what === "install") {
      const xml = readFileSync(path.join(ROOT, "launchd", "template.plist"), "utf8")
        .replaceAll("{{LABEL}}", label)
        .replaceAll("{{NODE}}", process.execPath)
        .replaceAll("{{ROOT}}", ROOT)
        .replaceAll("{{LOG}}", log);
      mkdirSync(path.dirname(plist), { recursive: true });
      mkdirSync(path.dirname(log), { recursive: true });
      try {
        ctl("bootout", `${target}/${label}`);
      } catch {}
      writeFileSync(plist, xml);
      ctl("bootstrap", target, plist);
      console.log(`installed ${plist}\nruns every hour, log at ${log}\nfirst run: jobsearch scan --hours 24`);
    } else if (what === "remove") {
      try {
        ctl("bootout", `${target}/${label}`);
      } catch {}
      console.log(existsSync(plist) ? `stopped. Delete ${plist} if you want it gone for good.` : "nothing installed.");
    } else {
      try {
        console.log(ctl("print", `${target}/${label}`).split("\n").filter((l) => /state|last exit|runs|program/.test(l)).join("\n") || "installed");
      } catch {
        console.log("not installed. Run: jobsearch schedule install");
      }
      if (existsSync(log)) console.log(`\nlast lines of ${log}:\n` + readFileSync(log, "utf8").trim().split("\n").slice(-6).join("\n"));
    }
  },
};

if (!commands[cmd]) {
  console.error(`unknown command: ${cmd}\n`);
  await commands.help();
  process.exit(1);
}
await commands[cmd]();
