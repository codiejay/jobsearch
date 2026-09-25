// Passes the page's "sharing the screen" signal (from share-main.js) to the
// extension. Content scripts can't be reached from the page's world directly.
window.addEventListener("message", (e) => {
  if (e.source !== window || typeof e.data?.__jobsearchShare !== "boolean") return;
  chrome.runtime.sendMessage({ share: e.data.__jobsearchShare }).catch(() => {});
});
