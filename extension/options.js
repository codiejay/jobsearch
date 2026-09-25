// Where the extension sends pages and forms, the online board "auto"
// falls back to, and the key for it. Kept in chrome.storage.local, read
// by background.js on every request.
const AUTO = "auto";
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["board", "online", "key"]).then(({ board = AUTO, online = "", key = "" }) => {
  $("board").value = board;
  $("online").value = online;
  $("key").value = key;
});

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const board = ($("board").value.trim() || AUTO).replace(/\/+$/, "");
  const online = $("online").value.trim().replace(/\/+$/, "");
  await chrome.storage.local.set({ board, online, key: $("key").value.trim() });
  $("board").value = board;
  $("online").value = online;
  $("saved").textContent = "Saved.";
});
