/* Overlay interact toggle + appearance prefs (loaded after app.js core if split; currently inlined into app.js) */

function isOverlayInteractOn() {
  try {
    var m = localStorage.getItem("sc_overlay_mode");
    if (m === "passthrough") return false;
    if (m === "scan" || m === "drag") return true;
    if (localStorage.getItem("sc_overlay_scan_click") === "1") return true;
    if (localStorage.getItem("sc_overlay_interact") === "0") return false;
    if (localStorage.getItem("sc_overlay_interact") === "1") return true;
  } catch (_) {}
  return false;
}

function setOverlayInteractLocal(on) {
  try {
    localStorage.setItem("sc_overlay_interact", on ? "1" : "0");
    localStorage.setItem("sc_overlay_mode", on ? "scan" : "passthrough");
    localStorage.setItem("sc_overlay_scan_click", on ? "1" : "0");
  } catch (_) {}
}

async function applyOverlayInteract(on) {
  setOverlayInteractLocal(!!on);
  var chk = document.getElementById("chk-overlay-interact");
  if (chk) chk.checked = !!on;
  var label = document.getElementById("overlay-interact-label");
  if (label) label.textContent = on ? "Click to scan & resize" : "Game clicks through";
  if (window.electronAPI && window.electronAPI.overlayClickThrough) {
    try {
      await window.electronAPI.overlayClickThrough(!on);
    } catch (_) {}
  }
  toast(on ? "Overlay: click to scan & resize ON" : "Overlay: game receives clicks");
}

async function onOverlayInteractToggle(chk) {
  await applyOverlayInteract(!!(chk && chk.checked));
}

function initOverlayInteract() {
  var on = isOverlayInteractOn();
  var chk = document.getElementById("chk-overlay-interact");
  if (chk) chk.checked = on;
  var label = document.getElementById("overlay-interact-label");
  if (label) label.textContent = on ? "Click to scan & resize" : "Game clicks through";
  setOverlayInteractLocal(on);
  if (window.electronAPI && window.electronAPI.overlayClickThrough) {
    window.electronAPI.overlayClickThrough(!on).catch(function () {});
  }
}

/* Font size delta (px) and family for overlay */
var OVERLAY_FONT_DELTA_MIN = -6;
var OVERLAY_FONT_DELTA_MAX = 12;

function getOverlayFontDelta() {
  try {
    var n = parseInt(localStorage.getItem("sc_overlay_font_delta"), 10);
    if (Number.isNaN(n)) return 0;
    return Math.max(OVERLAY_FONT_DELTA_MIN, Math.min(OVERLAY_FONT_DELTA_MAX, n));
  } catch (_) {
    return 0;
  }
}

function setOverlayFontDelta(n) {
  n = Math.max(OVERLAY_FONT_DELTA_MIN, Math.min(OVERLAY_FONT_DELTA_MAX, n | 0));
  try {
    localStorage.setItem("sc_overlay_font_delta", String(n));
  } catch (_) {}
  var el = document.getElementById("overlay-font-delta");
  if (el) el.textContent = (n > 0 ? "+" : "") + n;
  return n;
}

function changeOverlayFontSize(delta) {
  var n = setOverlayFontDelta(getOverlayFontDelta() + (delta | 0));
  toast("Overlay font size " + (n > 0 ? "+" : "") + n + "px");
}

function resetOverlayFontSize() {
  setOverlayFontDelta(0);
  toast("Overlay font size reset");
}

function getOverlayFontFamily() {
  try {
    return localStorage.getItem("sc_overlay_font_family") || "Segoe UI, system-ui, sans-serif";
  } catch (_) {
    return "Segoe UI, system-ui, sans-serif";
  }
}

function onOverlayFontFamilyChange(sel) {
  var v = (sel && sel.value) || "Segoe UI, system-ui, sans-serif";
  try {
    localStorage.setItem("sc_overlay_font_family", v);
  } catch (_) {}
  toast("Overlay font updated");
}

function initOverlayAppearance() {
  setOverlayFontDelta(getOverlayFontDelta());
  var sel = document.getElementById("overlay-font-family");
  if (sel) {
    var fam = getOverlayFontFamily();
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === fam) {
        sel.value = fam;
        found = true;
        break;
      }
    }
    if (!found && sel.options.length) sel.selectedIndex = 0;
  }
}

// Back-compat
async function onOverlayModeChange() {
  var chk = document.getElementById("chk-overlay-interact");
  await applyOverlayInteract(chk ? chk.checked : isOverlayInteractOn());
}
async function onOverlayDragCheckbox(chk) {
  await applyOverlayInteract(!!(chk && chk.checked));
}
async function onOverlayScanClickToggle(chk) {
  await applyOverlayInteract(!!(chk && chk.checked));
}
