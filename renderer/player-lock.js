/**
 * Full-screen UI lock when the log identifies a muted player.
 */
(function () {
  var locked = false;

  function ensureOverlay() {
    var el = document.getElementById("player-lock");
    if (el) return el;
    el = document.createElement("div");
    el.id = "player-lock";
    el.setAttribute("aria-live", "assertive");
    el.style.cssText =
      "display:none;position:fixed;inset:0;z-index:99999;background:#000;" +
      "color:#e6edf3;align-items:center;justify-content:center;" +
      "flex-direction:column;font-family:Segoe UI,system-ui,sans-serif;text-align:center;padding:2rem;";
    el.innerHTML =
      '<div style="font-size:1.75rem;font-weight:700;margin-bottom:0.75rem">Sorry, player-lock, you are muted.</div>' +
      '<div style="color:#8b949e;font-size:0.95rem;max-width:28rem;line-height:1.5">' +
      "This tracker will not work for you. The log identified your character as player-lock.</div>";
    document.body.appendChild(el);
    return el;
  }

  function applyLock(on) {
    locked = !!on;
    var el = ensureOverlay();
    el.style.display = locked ? "flex" : "none";
    if (locked) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.pointerEvents = "none";
      el.style.pointerEvents = "auto";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.pointerEvents = "";
    }
  }

  async function pollPlayer() {
    try {
      var r = await fetch("/api/player");
      var p = await r.json();
      if (p && p.muted) applyLock(true);
    } catch (_) {}
  }

  window.checkPlayerLock = pollPlayer;

  function boot() {
    ensureOverlay();
    pollPlayer();
    setInterval(pollPlayer, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 20);
  }
})();
