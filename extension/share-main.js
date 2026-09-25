// Runs in the page's own world, before its scripts. When the page starts
// sharing the screen (Meet, Teams, Slack on the web), say so, so the
// extension hides job notices until the share stops. Nothing else is read.
(() => {
  const md = navigator.mediaDevices;
  if (!md || !md.getDisplayMedia) return;
  const real = md.getDisplayMedia.bind(md);
  let live = 0;
  const tell = () => window.postMessage({ __jobsearchShare: live > 0 }, "*");
  md.getDisplayMedia = async (...args) => {
    const stream = await real(...args);
    live++;
    tell();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      live--;
      tell();
    };
    for (const t of stream.getTracks()) t.addEventListener("ended", end);
    stream.addEventListener("inactive", end);
    return stream;
  };
})();
