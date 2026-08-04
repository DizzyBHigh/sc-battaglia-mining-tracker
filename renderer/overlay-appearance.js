/* Apply overlay font size/family from localStorage (main UI writes these keys). */
(function () {
  function applyAppearance() {
    try {
      var d = parseInt(localStorage.getItem("sc_overlay_font_delta"), 10);
      if (Number.isNaN(d)) d = 0;
      document.documentElement.style.setProperty("--font-delta", d + "px");
      document.body.style.setProperty("--font-delta", d + "px");
      var fam = localStorage.getItem("sc_overlay_font_family") || "Segoe UI, system-ui, sans-serif";
      document.body.style.setProperty("--overlay-font", fam);
      document.body.style.fontFamily = fam;
    } catch (_) {}
  }
  applyAppearance();
  setInterval(applyAppearance, 400);
  window.addEventListener("storage", function (ev) {
    if (!ev.key) return;
    if (
      ev.key === "sc_overlay_font_delta" ||
      ev.key === "sc_overlay_font_family" ||
      ev.key === "sc_overlay_font_bump"
    ) {
      applyAppearance();
    }
  });
})();
