// Sends a page, a selection or a link to the job search board, on this
// machine (localhost:4750) or at the URL you host it at, as set in the
// options. The board reads the job out of it, writes the brief and letter,
// and tags it "Added by you". Takes about half a minute.
//
// It also fills application forms: "Fill this application" (or Alt+Shift+F)
// reads the form's fields, asks the board for answers and types them in.
// It never submits, never clicks a button and never leaves the page. You
// review the form and send it yourself.

const LOCAL = "http://localhost:4750";

// Is this machine's board running? If so, take the key from it, so the
// key never has to be pasted into the options.
async function localUp() {
  try {
    const r = await fetch(`${LOCAL}/api/extension`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const { key } = await r.json();
    if (key) await chrome.storage.local.set({ key });
    return true;
  } catch {
    return false;
  }
}

// The board and key from the options page. "auto" (the default) means this
// machine when its board is running, otherwise the online board saved in
// the options. The key is BOARD_KEY, only needed away from localhost,
// sent as the x-jobsearch-key header.
async function board() {
  const { board = "auto", online = "", key = "" } = await chrome.storage.local.get(["board", "online", "key"]);
  let base = board.replace(/\/+$/, "");
  if (!base || base === "auto") base = (await localUp()) ? LOCAL : online.replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };
  if (key && base !== LOCAL) headers["x-jobsearch-key"] = key;
  return { base, headers };
}

// What to say when the board can't be reached at all.
const offline = (base) =>
  !base
    ? `The board isn't running at ${LOCAL}, and no online board is set in the options.`
    : base === LOCAL
    ? `The board isn't running at ${base}. Start it with: npm run dev`
    : `Couldn't reach the board at ${base}.`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("desk", { periodInMinutes: 1 });
  checkDesk();
  chrome.contextMenus.create({ id: "page", title: "Send this page to Job search", contexts: ["page"] });
  chrome.contextMenus.create({ id: "link", title: "Send this link to Job search", contexts: ["link"] });
  chrome.contextMenus.create({ id: "selection", title: "Send the selected text to Job search", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "fill", title: "Fill this application", contexts: ["page", "editable"] });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "fill-form") return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) fillForm(tab);
});

chrome.action.onClicked.addListener((tab) => sendPage(tab));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "fill") fillForm(tab);
  else if (info.menuItemId === "link") send(tab, { url: info.linkUrl });
  else if (info.menuItemId === "selection") send(tab, { url: tab.url, title: tab.title, text: info.selectionText });
  else sendPage(tab);
});

// The page as the user sees it, so logged-in pages like X and LinkedIn
// work. A selection wins over the whole page.
async function sendPage(tab) {
  let text = "";
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (getSelection().toString() || document.body.innerText).slice(0, 60000),
    });
    text = r.result || "";
  } catch {}
  send(tab, { url: tab.url, title: tab.title, text });
}

async function send(tab, body) {
  badge(tab, "…", "#62615d");
  toast(tab, "wait", "Reading the post", "Drafting the brief and letter, about 30s");
  const { base, headers } = await board();
  try {
    const r = await fetch(`${base}/api/add`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || `Failed (${r.status})`);
    const verdict = { send: "Ready to apply", you: "Write yourself", skip: "Skip suggested" }[x.verdict] || "";
    badge(tab, "✓", "#5aa878");
    toast(
      tab,
      "ok",
      x.already ? "Already on your board" : `Added: ${x.title}`,
      x.already ? `${x.title}, ${x.company}` : `${x.company}${verdict ? `. ${verdict}` : ""}`
    );
  } catch (e) {
    badge(tab, "!", "#c99a45");
    const off = e instanceof TypeError;
    toast(tab, "err", "Not added", off ? offline(base) : e.message);
  }
  setTimeout(() => badge(tab, "", "#000"), 6000);
}

// Reads the form in every frame (Greenhouse embeds its form in an iframe),
// gets answers from the board, and fills each frame's fields.
async function fillForm(tab) {
  toast(tab, "wait", "Reading the form", "Finding the fields on this page");
  const { base, headers } = await board();
  try {
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectFields });
    const fields = [];
    let pageText = "";
    for (const f of frames) {
      if (!f.result) continue;
      pageText += f.result.text + "\n\n";
      for (const x of f.result.fields) fields.push({ ...x, key: `${f.frameId}:${x.key}` });
    }
    const empty = fields.filter((f) => !f.has);
    if (!empty.length) {
      toast(tab, "err", "No empty fields here", "Open the application form, then try again.");
      return;
    }

    toast(tab, "wait", "Writing answers, about 20s", `${empty.length} fields to fill`);
    const r = await fetch(`${base}/api/fill`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: tab.url,
        title: tab.title,
        pageText: pageText.slice(0, 20000),
        fields: empty.map(({ has, ...f }) => f),
      }),
    });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || `Failed (${r.status})`);

    // The CV PDF, for the resume upload. The board serves it at /api/cv
    // and names it in the answer's value. Fetched here because the page
    // itself can't reach localhost.
    let resume = null;
    const cvAnswer = x.answers.find((a) => a.kind === "fact" && fields.find((f) => f.key === a.key)?.type === "file");
    if (cvAnswer) {
      try {
        const bytes = new Uint8Array(await (await fetch(`${base}/api/cv`, { headers })).arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resume = { name: cvAnswer.value || "cv.pdf", type: "application/pdf", base64: btoa(bin) };
      } catch {}
    }

    let filled = 0;
    const left = [];
    for (const f of frames) {
      const mine = x.answers
        .filter((a) => a.key.startsWith(`${f.frameId}:`))
        .map((a) => ({ ...a, key: a.key.slice(String(f.frameId).length + 1) }));
      if (!mine.length) continue;
      const [done] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [f.frameId] },
        func: fillFields,
        args: [mine, resume],
      });
      filled += done.result.filled;
      left.push(...done.result.left);
    }

    const short = Array.from(new Set(left.map((l) => l.toLowerCase()))).slice(0, 6).join(", ");
    if (x.aiBan)
      toast(tab, "err", "Filled the basics", "They ban AI-written answers. The written ones are yours.");
    else
      toast(
        tab,
        "ok",
        `Filled ${filled} ${filled === 1 ? "field" : "fields"}`,
        left.length ? `Left for you: ${short}` : x.matched ? `For ${x.matched.company}. Check it, then submit.` : "Check it, then submit."
      );
  } catch (e) {
    const off = e instanceof TypeError;
    toast(tab, "err", "Not filled", off ? offline(base) : e.message);
  }
}

// Runs in the page, once per frame. Lists the form's visible fields and
// tags each with data-jobsearch-key so fillFields can find it again. Plain
// function, no outside variables: Chrome copies its source into the page.
function collectFields() {
  const clip = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const byId = (id) => (id ? document.getElementById(id) : null);

  function labelOf(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clip(l.innerText)) return clip(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap && clip(wrap.innerText)) return clip(wrap.innerText);
    if (el.getAttribute("aria-label")) return clip(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => byId(id)?.innerText || "").join(" ");
      if (clip(t)) return clip(t);
    }
    if (el.placeholder) return clip(el.placeholder);
    // Nearest text before the field inside its container.
    for (let box = el.parentElement, n = 0; box && n < 4; box = box.parentElement, n++) {
      const t = clip(Array.from(box.childNodes).filter((c) => !c.contains(el)).map((c) => c.innerText || c.textContent || "").join(" "));
      if (t) return t;
    }
    return clip(el.name || el.id);
  }
  // A radio group's question is the fieldset legend or the text around it.
  function groupLabel(first) {
    const set = first.closest("fieldset");
    const legend = set && set.querySelector("legend");
    if (legend && clip(legend.innerText)) return clip(legend.innerText);
    const rg = first.closest('[role="radiogroup"],[role="group"]');
    if (rg) {
      const by = rg.getAttribute("aria-labelledby");
      if (by && byId(by)) return clip(byId(by).innerText);
      if (rg.getAttribute("aria-label")) return clip(rg.getAttribute("aria-label"));
    }
    const optionLabel = labelOf(first);
    for (let box = (first.closest("label") || first).parentElement, n = 0; box && n < 5; box = box.parentElement, n++) {
      const t = clip(box.innerText.replace(optionLabel, ""));
      const own = Array.from(box.querySelectorAll("input")).every((i) => i.name === first.name);
      if (!own) break;
      if (t && t.length > optionLabel.length) {
        const q = Array.from(box.childNodes).filter((c) => !c.querySelector?.("input") && c.nodeName !== "INPUT");
        const head = clip(q.map((c) => c.innerText || c.textContent || "").join(" "));
        if (head) return head;
      }
    }
    return clip(first.name);
  }
  const need = (el, label) =>
    el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|^\*/.test(label);

  document.querySelectorAll("[data-jobsearch-key]").forEach((el) => el.removeAttribute("data-jobsearch-key"));
  const fields = [];
  const groups = new Set();
  let n = 0;
  const els = document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.type || "text").toLowerCase() : tag === "select" || tag === "textarea" ? tag : "contenteditable";
    if (["hidden", "submit", "button", "reset", "image", "password", "search"].includes(type)) continue;
    if (el.disabled || el.readOnly) continue;
    // Custom-styled radios, checkboxes and uploads hide the input itself,
    // so judge those by their label.
    const face = ["radio", "checkbox", "file"].includes(type) ? el.closest("label") || el.parentElement : el;
    if (!face || !shown(face)) continue;
    const key = String(n++);

    if (type === "radio" || (type === "checkbox" && el.name && document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length > 1)) {
      const sel = `input[type=${type}][name="${CSS.escape(el.name)}"]`;
      if (!el.name || groups.has(sel)) {
        if (!el.name) {
          el.setAttribute("data-jobsearch-key", key);
          const label = labelOf(el);
          fields.push({ key, label, type, required: need(el, label), has: el.checked });
        }
        continue;
      }
      groups.add(sel);
      const all = Array.from(document.querySelectorAll(sel));
      all.forEach((r) => r.setAttribute("data-jobsearch-key", key));
      const label = groupLabel(el);
      fields.push({
        key,
        label,
        type: type === "radio" ? "radio" : "checkbox-group",
        required: all.some((r) => need(r, label)),
        options: all.map((r) => labelOf(r)),
        has: all.some((r) => r.checked),
      });
      continue;
    }

    el.setAttribute("data-jobsearch-key", key);
    const label = labelOf(el);
    const f = { key, label, type, required: need(el, label) };
    if (tag === "select") {
      f.options = Array.from(el.options).map((o) => clip(o.text)).filter(Boolean);
      f.has = el.selectedIndex > 0 && el.value !== "";
    } else if (type === "checkbox") {
      f.has = el.checked;
    } else if (type === "file") {
      f.has = el.files && el.files.length > 0;
    } else if (type === "contenteditable") {
      f.has = clip(el.innerText) !== "";
    } else {
      f.has = el.value.trim() !== "";
    }
    if (el.maxLength > 0) f.maxLength = el.maxLength;
    fields.push(f);
  }
  return { fields, text: (document.body ? document.body.innerText : "").slice(0, 20000) };
}

// Runs in the page, in one frame. Types the answers in the way a person
// would, so React-controlled forms see them. Skips any field that already
// has a value, clicks nothing but the chosen radio or checkbox, and never
// submits. Outlines what it filled in green and what it left in amber.
function fillFields(answers, resume) {
  const GREEN = "1px solid #5aa878";
  const AMBER = "1px solid #c99a45";
  const mark = (el, color) => {
    // Hidden inputs behind a styled button or label get the outline on
    // what the user sees instead.
    const box =
      el.type === "radio" || el.type === "checkbox"
        ? el.closest("fieldset") || el.closest("label") || el.parentElement
        : el.getClientRects().length
        ? el
        : el.closest("label") || el.parentElement;
    box.style.outline = color;
    box.style.outlineOffset = "2px";
  };
  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const text = (el) => (el.labels && el.labels[0] ? el.labels[0].innerText : el.closest("label")?.innerText || el.value || "").replace(/\s+/g, " ").trim();

  let filled = 0;
  const left = [];
  for (const a of answers) {
    const els = Array.from(document.querySelectorAll(`[data-jobsearch-key="${a.key}"]`));
    const el = els[0];
    if (!el) continue;
    const short = (a.label || "").replace(/\*/g, "").trim().split(/[?:.(]/)[0].slice(0, 40).trim().toLowerCase();
    const leave = () => {
      mark(el, AMBER);
      left.push(short);
    };
    if (a.kind === "skip" || (!a.value && el.type !== "file")) {
      leave();
      continue;
    }
    try {
      if (el.type === "radio" || (el.type === "checkbox" && els.length > 1)) {
        if (els.some((r) => r.checked)) continue;
        const pick = els.find((r) => text(r) === a.value) || els.find((r) => text(r).toLowerCase() === a.value.toLowerCase());
        if (!pick) {
          leave();
          continue;
        }
        pick.click();
        mark(pick, GREEN);
      } else if (el.type === "checkbox") {
        if (el.checked) continue;
        if (/^yes$/i.test(a.value)) el.click();
        mark(el, GREEN);
      } else if (el.tagName === "SELECT") {
        if (el.selectedIndex > 0 && el.value !== "") continue;
        const opt = Array.from(el.options).find((o) => o.text.replace(/\s+/g, " ").trim() === a.value);
        if (!opt) {
          leave();
          continue;
        }
        setValue(el, opt.value);
        mark(el, GREEN);
      } else if (el.type === "file") {
        if (el.files && el.files.length) continue;
        if (!resume) {
          leave();
          continue;
        }
        const bin = atob(resume.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], resume.name, { type: resume.type }));
        el.files = dt.files;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (!el.files.length) {
          leave();
          continue;
        }
        mark(el, GREEN);
      } else if (el.isContentEditable) {
        if (el.innerText.trim()) continue;
        el.focus();
        document.execCommand("insertText", false, a.value);
        mark(el, GREEN);
      } else {
        if (el.value.trim()) continue;
        if (el.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(a.value)) {
          leave();
          continue;
        }
        setValue(el, a.value);
        if (el.value !== a.value && el.maxLength <= 0) {
          leave();
          continue;
        }
        mark(el, GREEN);
      }
      filled++;
    } catch {
      leave();
    }
  }
  return { filled, left };
}

function badge(tab, text, color) {
  chrome.action.setBadgeText({ tabId: tab.id, text });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color });
}

// A small notice in the top right of the page, in the board's own look:
// dark panel, hairline border, and the table's heat bar as the progress
// bar. The bar fills once toward the ~30s estimate, then settles green
// (added) or amber (not added). No loops.
function toast(tab, state, title, message) {
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      args: [state, title, message],
      func: (state, title, message) => {
        const ID = "__jobsearch_toast";
        let el = document.getElementById(ID);
        if (!el) {
          el = document.createElement("div");
          el.id = ID;
          el.innerHTML =
            '<div data-k="top"><span data-k="track"><span data-k="fill"></span></span><span data-k="label">Job search</span></div>' +
            '<div data-k="title"></div><div data-k="msg"></div>';
          const css = (k, v) => (k ? el.querySelector(`[data-k="${k}"]`) : el).setAttribute("style", v);
          css(null, "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;box-sizing:border-box;width:272px;padding:11px 13px 12px;background:#151514;border:1px solid #242422;border-radius:10px;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);font:12px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e8e7e3;-webkit-font-smoothing:antialiased;opacity:0;transform:translateY(-4px);transition:opacity .22s cubic-bezier(.25,1,.5,1),transform .22s cubic-bezier(.25,1,.5,1)");
          css("top", "display:flex;align-items:center;gap:8px;margin-bottom:6px");
          css("track", "display:block;width:34px;height:3px;border-radius:3px;background:#262624;overflow:hidden");
          css("fill", "display:block;height:100%;width:0;border-radius:3px;background:#8f8e89;transition:width 30s cubic-bezier(.1,.6,.3,1),background-color .2s");
          css("label", "color:#62615d;font-size:11px");
          css("title", "font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
          css("msg", "margin-top:1px;color:#8f8e89;font-size:11.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden");
          document.documentElement.appendChild(el);
          el.getBoundingClientRect();
          el.style.opacity = "1";
          el.style.transform = "none";
        }
        const q = (k) => el.querySelector(`[data-k="${k}"]`);
        const fill = q("fill");
        q("title").textContent = title;
        q("title").title = title;
        q("msg").textContent = message;
        q("msg").title = message;
        if (state === "wait") {
          fill.getBoundingClientRect();
          fill.style.width = "88%";
        } else {
          fill.style.transition = "width .3s cubic-bezier(.25,1,.5,1), background-color .2s";
          fill.style.width = "100%";
          fill.style.background = state === "ok" ? "#5aa878" : "#c99a45";
        }
        clearTimeout(el.__t);
        if (state !== "wait")
          el.__t = setTimeout(() => {
            el.style.opacity = "0";
            el.style.transform = "translateY(-4px)";
            setTimeout(() => el.remove(), 250);
          }, 5000);
      },
    })
    .catch(() => {});
}

// ---------- new roles on screen ----------
//
// About once a minute the extension checks in with the board. That tells
// the hourly scan you're at the computer, so it shows new roles here
// instead of pinging the phone. The board answers with the roles waiting
// for you, and a notice stays top right in whatever tab you're on until
// you open the board, snooze it or mute it. Never while a screen is being shared:
// a tab sharing through Chrome (Meet, Teams, Slack on the web) or Zoom.

const SNOOZE = 30 * 6e4;
const MUTE = 60 * 6e4;

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("desk", { periodInMinutes: 1 });
  checkDesk();
});
chrome.alarms.onAlarm.addListener((a) => a.name === "desk" && checkDesk());

async function state() {
  const { sharingTabs = [], pending = [], appSharing = false } = await chrome.storage.session.get(["sharingTabs", "pending", "appSharing"]);
  const { snoozeUntil = 0, holdUntil = 0 } = await chrome.storage.local.get(["snoozeUntil", "holdUntil"]);
  return { sharingTabs, pending, appSharing, snoozeUntil, holdUntil };
}

async function checkDesk(seen = []) {
  const s = await state();
  const { base, headers } = await board();
  try {
    const r = await fetch(`${base}/api/desk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sharing: s.sharingTabs.length > 0 || s.appSharing, holdUntil: s.holdUntil, seen }),
    });
    if (!r.ok) return;
    const x = await r.json();
    await chrome.storage.session.set({ pending: x.roles, appSharing: x.appSharing, base });
  } catch {
    return;
  }
  showWhereAllowed();
}

async function showWhereAllowed() {
  const s = await state();
  const now = Date.now();
  if (!s.pending.length || s.sharingTabs.length || s.appSharing || s.snoozeUntil > now || s.holdUntil > now) return hideEverywhere();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && /^https?:/.test(tab.url || "")) showDesk(tab, s.pending);
}

async function hideEverywhere() {
  for (const t of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }))
    chrome.scripting
      .executeScript({ target: { tabId: t.id }, func: () => document.getElementById("__jobsearch_ready")?.remove() })
      .catch(() => {});
}

// Follows you to the next tab.
chrome.tabs.onActivated.addListener(() => showWhereAllowed());
chrome.tabs.onUpdated.addListener((id, info, tab) => info.status === "complete" && tab.active && showWhereAllowed());
chrome.tabs.onRemoved.addListener(async (id) => {
  const { sharingTabs = [] } = await chrome.storage.session.get("sharingTabs");
  if (sharingTabs.includes(id)) await chrome.storage.session.set({ sharingTabs: sharingTabs.filter((t) => t !== id) });
});

chrome.runtime.onMessage.addListener((m, sender) => {
  (async () => {
    if ("share" in m && sender.tab) {
      const { sharingTabs = [] } = await chrome.storage.session.get("sharingTabs");
      const next = m.share ? Array.from(new Set([...sharingTabs, sender.tab.id])) : sharingTabs.filter((t) => t !== sender.tab.id);
      await chrome.storage.session.set({ sharingTabs: next });
      if (m.share) hideEverywhere();
      else showWhereAllowed();
    } else if (m.desk === "open") {
      const { base = LOCAL } = await chrome.storage.session.get("base");
      chrome.tabs.create({ url: `${base}/` });
      await chrome.storage.session.set({ pending: [] });
      hideEverywhere();
      checkDesk(m.ids);
    } else if (m.desk === "later") {
      await chrome.storage.local.set({ snoozeUntil: Date.now() + SNOOZE });
      hideEverywhere();
    } else if (m.desk === "mute") {
      await chrome.storage.local.set({ holdUntil: Date.now() + MUTE });
      hideEverywhere();
      checkDesk();
    }
  })();
});

// Runs in the page. Everything inline, so the page's CSS can't reach it.
// Redrawn only when the roles change, so switching tabs doesn't replay it.
function deskToast(roles) {
  const ID = "__jobsearch_ready";
  const sig = roles.map((r) => r.id).join(",");
  const old = document.getElementById(ID);
  if (old && old.dataset.sig === sig) return;
  old?.remove();

  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const shown = roles.slice(0, 4);
  const more = roles.length - shown.length;
  const el = document.createElement("div");
  el.id = ID;
  el.dataset.sig = sig;
  el.innerHTML = `
    <div data-k="head">
      <span data-k="dot"></span>
      <span data-k="count">${roles.length} ${roles.length === 1 ? "role" : "roles"} ready</span>
      <button data-k="mute" title="No notices for an hour. The phone gets them instead.">Mute 1h</button>
    </div>
    <div data-k="list">
      ${shown
        .map(
          (r) => `
        <div data-k="row">
          <span data-k="fit">${esc(r.fit)}</span>
          <span data-k="text">
            <span data-k="title">${esc(r.title)}</span>
            <span data-k="meta">${esc(r.company)}${r.where ? `, ${esc(r.where)}` : ""}</span>
          </span>
          <span data-k="verdict" data-v="${r.verdict}">${r.verdict === "send" ? "Ready to apply" : "Write yourself"}</span>
        </div>`
        )
        .join("")}
      ${more > 0 ? `<div data-k="more">${more} more on the board</div>` : ""}
    </div>
    <div data-k="foot">
      <button data-k="open">Open the board</button>
      <button data-k="later">Later</button>
    </div>`;

  const S = (k, v) => el.querySelectorAll(`[data-k="${k}"]`).forEach((x) => x.setAttribute("style", v));
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
  el.setAttribute("style", `all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;box-sizing:border-box;width:348px;background:#151514;border:1px solid #2c2c29;border-radius:12px;box-shadow:0 24px 60px -18px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.18);font:12px/1.45 ${sans};color:#e8e7e3;-webkit-font-smoothing:antialiased;overflow:hidden;opacity:0;transform:translateY(-8px);transition:opacity .28s cubic-bezier(.25,1,.5,1),transform .28s cubic-bezier(.25,1,.5,1)`);
  S("head", "display:flex;align-items:center;gap:8px;padding:13px 15px 10px;border-bottom:1px solid #22221f");
  S("dot", "width:7px;height:7px;border-radius:50%;background:#5aa878;flex:none");
  S("count", "font-size:13px;font-weight:500;color:#f1f0ec");
  S("mute", `all:unset;margin-left:auto;color:#62615d;font:11px ${sans};cursor:pointer`);
  S("list", "display:block;padding:4px 0");
  S("row", "display:flex;align-items:center;gap:12px;padding:9px 15px");
  S("fit", "flex:none;width:26px;font-variant-numeric:tabular-nums;font-size:13px;color:#f1f0ec;font-weight:500");
  S("text", "display:flex;flex-direction:column;min-width:0;flex:1");
  S("title", "font-size:12.5px;color:#e8e7e3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
  S("meta", "font-size:11.5px;color:#8f8e89;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
  S("verdict", "flex:none;font-size:11px");
  S("more", "padding:4px 15px 8px 53px;color:#62615d;font-size:11.5px");
  S("foot", "display:flex;gap:8px;padding:10px 15px 14px;border-top:1px solid #22221f");
  S("open", `all:unset;flex:1;text-align:center;padding:8px 0;border-radius:8px;background:#e8e7e3;color:#151514;font:500 12px ${sans};cursor:pointer`);
  S("later", `all:unset;padding:8px 14px;border-radius:8px;border:1px solid #2c2c29;color:#8f8e89;font:12px ${sans};cursor:pointer`);
  el.querySelectorAll('[data-k="verdict"]').forEach((v) => (v.style.color = v.dataset.v === "send" ? "#5aa878" : "#c99a45"));

  const ids = roles.map((r) => r.id);
  const say = (desk) => chrome.runtime.sendMessage({ desk, ids });
  el.querySelector('[data-k="open"]').onclick = () => say("open");
  el.querySelector('[data-k="later"]').onclick = () => say("later");
  el.querySelector('[data-k="mute"]').onclick = () => say("mute");

  document.documentElement.appendChild(el);
  el.getBoundingClientRect();
  el.style.opacity = "1";
  el.style.transform = "none";
}

function showDesk(tab, roles) {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deskToast, args: [roles] }).catch(() => {});
}
