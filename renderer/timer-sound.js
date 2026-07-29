/**
 * Session stopwatch + deposit alerts (sound presets / volume).
 * Publishes timer state to localStorage for the overlay.
 * Completed-set history is not listed here — mission cards show duration.
 */
(function () {
  var running = false;
  var startedAt = 0;
  var accumulated = 0;
  var tickTimer = null;
  var soundEnabled = true;
  var soundPreset = "chime";
  var soundVolume = 0.7;
  var showTimerOnOverlay = false;
  var seenAlertIds = {};
  var lastAlertPoll = new Date().toISOString();
  var audioCtx = null;
  var prevActiveCount = null;
  var seenLogAcceptKeys = {};
  var autoTimerEnabled = true;
  var logAcceptBootstrapped = false;

  var SOUND_PRESETS = {
    chime: { label: "Chime (two-tone)" },
    ping: { label: "Ping" },
    soft: { label: "Soft bell" },
    alert: { label: "Alert blip" },
    glass: { label: "Glass" },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function formatMs(ms) {
    if (ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var cs = Math.floor((ms % 1000) / 10);
    function pad(n, w) {
      w = w || 2;
      var t = String(n);
      while (t.length < w) t = "0" + t;
      return t;
    }
    if (h > 0) return pad(h) + ":" + pad(m) + ":" + pad(s);
    return pad(m) + ":" + pad(s) + "." + pad(cs);
  }

  function elapsedNow() {
    if (!running) return accumulated;
    return accumulated + (Date.now() - startedAt);
  }

  function publishTimerState() {
    try {
      localStorage.setItem(
        "sc_timer_state",
        JSON.stringify({
          running: running,
          startedAt: startedAt,
          accumulated: accumulated,
          showOnOverlay: showTimerOnOverlay,
          updatedAt: Date.now(),
        })
      );
    } catch (_) {}
  }

  function renderClock() {
    var el = $("stopwatch-display");
    if (el) el.textContent = formatMs(elapsedNow());
    var st = $("stopwatch-state");
    if (st) {
      if (running) st.textContent = "Running";
      else if (accumulated) st.textContent = "Paused";
      else st.textContent = "Stopped";
    }
    publishTimerState();
  }

  function clearLapsUi() {
    var box = $("stopwatch-laps");
    if (!box) return;
    box.innerHTML = "";
    box.style.display = "none";
  }

  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(renderClock, 50);
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function startStopwatch(opts) {
    opts = opts || {};
    if (running) return;
    running = true;
    startedAt = Date.now();
    startTick();
    renderClock();
    if (!opts.silent && typeof toast === "function") {
      toast(opts.auto ? "Stopwatch auto-started (mission accepted)" : "Stopwatch started");
    }
  }

  function pauseStopwatch(opts) {
    opts = opts || {};
    if (!running) return;
    accumulated += Date.now() - startedAt;
    running = false;
    stopTick();
    renderClock();
    if (!opts.silent && typeof toast === "function") toast("Stopwatch paused");
  }

  function resetStopwatch() {
    running = false;
    accumulated = 0;
    startedAt = 0;
    stopTick();
    renderClock();
  }

  /** Stop the session timer without logging Set 1/2/3 — times live on mission cards. */
  function finishSet(opts) {
    opts = opts || {};
    var ms = elapsedNow();
    if (ms < 500) {
      if (!opts.auto && typeof toast === "function") toast("Start the stopwatch first");
      resetStopwatch();
      return;
    }
    if (running) {
      accumulated += Date.now() - startedAt;
      running = false;
      stopTick();
    }
    if (typeof toast === "function") {
      toast(
        (opts.auto ? "All missions done — session " : "Session finished in ") +
          formatMs(ms) +
          " (see mission cards for times)"
      );
    }
    try {
      localStorage.removeItem("sc_stopwatch_laps");
    } catch (_) {}
    clearLapsUi();
    resetStopwatch();
  }

  function countActiveScanMissions() {
    var cache =
      typeof missionsCache !== "undefined" && Array.isArray(missionsCache)
        ? missionsCache
        : [];
    var n = 0;
    for (var i = 0; i < cache.length; i++) {
      var m = cache[i];
      if (!m || m.status !== "active") continue;
      if (typeof isMiningScanTitle === "function") {
        if (!isMiningScanTitle(m.title)) continue;
      }
      n += 1;
    }
    return n;
  }

  function checkActiveMissionTransitions() {
    if (!autoTimerEnabled) return;
    var n = countActiveScanMissions();
    if (prevActiveCount === null) {
      prevActiveCount = n;
      return;
    }
    if (n === 0 && prevActiveCount > 0 && (running || accumulated >= 500)) {
      finishSet({ auto: true });
    }
    prevActiveCount = n;
  }

  async function pollLogAccepts() {
    if (!autoTimerEnabled) return;
    try {
      var r = await fetch("/api/log-events?limit=40");
      var list = await r.json();
      if (!Array.isArray(list)) return;

      if (!logAcceptBootstrapped) {
        for (var i = 0; i < list.length; i++) {
          var e0 = list[i];
          if (!e0) continue;
          var k0 =
            (e0.id || "") +
            "|" +
            (e0.kind || "") +
            "|" +
            (e0.mission_id || "") +
            "|" +
            (e0.timestamp || "");
          seenLogAcceptKeys[k0] = 1;
        }
        logAcceptBootstrapped = true;
        return;
      }

      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!e) continue;
        var kind = String(e.kind || "").toLowerCase();
        var action = String(e.action || "").toUpperCase();
        var isAccept =
          kind === "accept" ||
          action === "ACCEPT" ||
          kind === "contract" ||
          action === "CONTRACT";
        if (!isAccept) continue;

        var key =
          (e.id || "") +
          "|" +
          (e.kind || "") +
          "|" +
          (e.mission_id || "") +
          "|" +
          (e.timestamp || "");
        if (seenLogAcceptKeys[key]) continue;
        seenLogAcceptKeys[key] = 1;

        if (!running) startStopwatch({ auto: true });
      }

      var keys = Object.keys(seenLogAcceptKeys);
      if (keys.length > 120) {
        keys.slice(0, keys.length - 60).forEach(function (k) {
          delete seenLogAcceptKeys[k];
        });
      }
    } catch (_) {}
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }

  function volGain(base) {
    var v = Math.max(0, Math.min(1, soundVolume));
    return Math.max(0.0001, (base || 0.22) * v);
  }

  function tone(ctx, type, freq, t0, dur, gain) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(volGain(gain), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function playPreset(name) {
    if (!soundEnabled) return;
    try {
      var ctx = ensureAudio();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      var p = name || soundPreset;
      if (p === "ping") {
        tone(ctx, "sine", 1320, now, 0.09, 0.28);
      } else if (p === "soft") {
        tone(ctx, "sine", 523.25, now, 0.22, 0.18);
        tone(ctx, "sine", 659.25, now + 0.08, 0.28, 0.14);
      } else if (p === "alert") {
        tone(ctx, "square", 740, now, 0.07, 0.12);
        tone(ctx, "square", 740, now + 0.12, 0.07, 0.12);
        tone(ctx, "square", 988, now + 0.24, 0.1, 0.14);
      } else if (p === "glass") {
        tone(ctx, "triangle", 1568, now, 0.35, 0.16);
        tone(ctx, "sine", 2093, now + 0.02, 0.25, 0.08);
      } else {
        tone(ctx, "sine", 880, now, 0.12, 0.25);
        tone(ctx, "sine", 1174.7, now + 0.14, 0.18, 0.22);
      }
    } catch (e) {
      console.warn("[sound]", e);
    }
  }

  function playDepositChime() {
    playPreset(soundPreset);
  }

  async function pollScanReady() {
    try {
      var r = await fetch(
        "/api/scan-ready?since=" + encodeURIComponent(lastAlertPoll)
      );
      var list = await r.json();
      if (!Array.isArray(list) || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a || !a.id || seenAlertIds[a.id]) continue;
        seenAlertIds[a.id] = 1;
        if (a.timestamp && a.timestamp > lastAlertPoll) lastAlertPoll = a.timestamp;
        playDepositChime();
        if (typeof toast === "function") toast("Deposit ready to scan");
        if (typeof loadActedLog === "function") loadActedLog();
      }
      var keys = Object.keys(seenAlertIds);
      if (keys.length > 80) {
        keys.slice(0, keys.length - 40).forEach(function (k) {
          delete seenAlertIds[k];
        });
      }
    } catch (_) {}
  }

  function populateSoundSelect() {
    var sel = $("deposit-sound-preset");
    if (!sel) return;
    var prev = soundPreset;
    sel.innerHTML = Object.keys(SOUND_PRESETS)
      .map(function (k) {
        return (
          '<option value="' +
          k +
          '">' +
          SOUND_PRESETS[k].label +
          "</option>"
        );
      })
      .join("");
    if (SOUND_PRESETS[prev]) sel.value = prev;
  }

  function syncVolumeLabel() {
    var lab = $("deposit-sound-vol-label");
    if (lab) lab.textContent = Math.round(soundVolume * 100) + "%";
    var sl = $("deposit-sound-volume");
    if (sl) sl.value = String(Math.round(soundVolume * 100));
  }

  function loadPersisted() {
    try {
      localStorage.removeItem("sc_stopwatch_laps");
    } catch (_) {}
    try {
      var se = localStorage.getItem("sc_deposit_sound");
      if (se != null) soundEnabled = se === "1";
    } catch (_) {}
    try {
      var at = localStorage.getItem("sc_auto_timer");
      if (at != null) autoTimerEnabled = at === "1";
    } catch (_) {}
    try {
      var sp = localStorage.getItem("sc_deposit_sound_preset");
      if (sp && SOUND_PRESETS[sp]) soundPreset = sp;
    } catch (_) {}
    try {
      var sv = localStorage.getItem("sc_deposit_sound_volume");
      if (sv != null) {
        var n = parseFloat(sv);
        if (!isNaN(n)) soundVolume = Math.max(0, Math.min(1, n));
      }
    } catch (_) {}
    try {
      var ot = localStorage.getItem("sc_timer_on_overlay");
      if (ot != null) showTimerOnOverlay = ot === "1";
    } catch (_) {}

    var chk = $("chk-deposit-sound");
    if (chk) chk.checked = soundEnabled;
    var chkT = $("chk-auto-timer");
    if (chkT) chkT.checked = autoTimerEnabled;
    var chkO = $("chk-timer-overlay");
    if (chkO) chkO.checked = showTimerOnOverlay;
    populateSoundSelect();
    syncVolumeLabel();
    clearLapsUi();
    renderClock();
  }

  function onSoundToggle(chk) {
    soundEnabled = !!(chk && chk.checked);
    try {
      localStorage.setItem("sc_deposit_sound", soundEnabled ? "1" : "0");
    } catch (_) {}
    if (soundEnabled) {
      ensureAudio();
      playDepositChime();
    }
  }

  function onSoundPresetChange(sel) {
    var v = sel && sel.value;
    if (v && SOUND_PRESETS[v]) {
      soundPreset = v;
      try {
        localStorage.setItem("sc_deposit_sound_preset", soundPreset);
      } catch (_) {}
      if (soundEnabled) playDepositChime();
    }
  }

  function onSoundVolumeChange(sl) {
    var n = parseInt(sl && sl.value, 10);
    if (isNaN(n)) return;
    soundVolume = Math.max(0, Math.min(100, n)) / 100;
    try {
      localStorage.setItem("sc_deposit_sound_volume", String(soundVolume));
    } catch (_) {}
    syncVolumeLabel();
  }

  function onAutoTimerToggle(chk) {
    autoTimerEnabled = !!(chk && chk.checked);
    try {
      localStorage.setItem("sc_auto_timer", autoTimerEnabled ? "1" : "0");
    } catch (_) {}
    if (typeof toast === "function") {
      toast(
        autoTimerEnabled
          ? "Auto timer on (start on accept, stop when all done)"
          : "Auto timer off"
      );
    }
  }

  function onTimerOverlayToggle(chk) {
    showTimerOnOverlay = !!(chk && chk.checked);
    try {
      localStorage.setItem("sc_timer_on_overlay", showTimerOnOverlay ? "1" : "0");
    } catch (_) {}
    publishTimerState();
    if (typeof toast === "function") {
      toast(showTimerOnOverlay ? "Timer shown on overlay" : "Timer hidden from overlay");
    }
  }

  function testSound() {
    soundEnabled = true;
    var chk = $("chk-deposit-sound");
    if (chk) chk.checked = true;
    try {
      localStorage.setItem("sc_deposit_sound", "1");
    } catch (_) {}
    playDepositChime();
    if (typeof toast === "function") toast("Test: " + (SOUND_PRESETS[soundPreset] || {}).label);
  }

  window.startStopwatch = function () {
    startStopwatch({});
  };
  window.pauseStopwatch = function () {
    pauseStopwatch({});
  };
  window.resetStopwatch = resetStopwatch;
  window.finishStopwatchSet = function () {
    finishSet({});
  };
  window.onDepositSoundToggle = onSoundToggle;
  window.onDepositSoundPresetChange = onSoundPresetChange;
  window.onDepositSoundVolumeChange = onSoundVolumeChange;
  window.onAutoTimerToggle = onAutoTimerToggle;
  window.onTimerOverlayToggle = onTimerOverlayToggle;
  window.testDepositSound = testSound;
  window.playDepositChime = playDepositChime;
  window.checkStopwatchMissions = checkActiveMissionTransitions;

  function boot() {
    loadPersisted();
    setInterval(pollScanReady, 1500);
    setInterval(pollLogAccepts, 2000);
    setInterval(checkActiveMissionTransitions, 2000);
    setInterval(publishTimerState, 250);
    function unlock() {
      ensureAudio();
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    }
    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 30);
  }
})();
