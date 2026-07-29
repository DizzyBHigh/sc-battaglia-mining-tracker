/**
 * Session stopwatch + audible alert when Game.log reports a mineral deposit.
 * Auto-starts on log ACCEPT/CONTRACT; auto-finishes when no active scan missions remain.
 */
(function () {
  var running = false;
  var startedAt = 0;
  var accumulated = 0;
  var tickTimer = null;
  var laps = [];
  var soundEnabled = true;
  var seenAlertIds = {};
  var lastAlertPoll = new Date().toISOString();
  var audioCtx = null;
  var prevActiveCount = null;
  var seenLogAcceptKeys = {};
  var autoTimerEnabled = true;
  var logAcceptBootstrapped = false;

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

  function renderClock() {
    var el = $("stopwatch-display");
    if (el) el.textContent = formatMs(elapsedNow());
    var st = $("stopwatch-state");
    if (st) {
      if (running) st.textContent = "Running";
      else if (accumulated) st.textContent = "Paused";
      else st.textContent = "Stopped";
    }
  }

  function renderLaps() {
    var box = $("stopwatch-laps");
    if (!box) return;
    if (!laps.length) {
      box.innerHTML =
        '<div class="empty" style="padding:0.4rem 0">No completed sets yet</div>';
      return;
    }
    box.innerHTML = laps
      .slice()
      .reverse()
      .slice(0, 8)
      .map(function (l, i) {
        return (
          '<div class="history-item"><strong>Set ' +
          (laps.length - i) +
          "</strong> " +
          formatMs(l.ms) +
          (l.auto ? ' <span style="color:var(--accent)">(auto)</span>' : "") +
          '<br/><span style="font-size:0.7rem">' +
          (l.at || "") +
          "</span></div>"
        );
      })
      .join("");
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
    var at = new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    laps.push({ ms: ms, at: at, auto: !!opts.auto });
    if (laps.length > 40) laps.shift();
    renderLaps();
    try {
      localStorage.setItem("sc_stopwatch_laps", JSON.stringify(laps));
    } catch (_) {}
    if (typeof toast === "function") {
      toast(
        (opts.auto ? "All missions done — set finished in " : "Set finished in ") +
          formatMs(ms)
      );
    }
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

  /**
   * When active scan missions drop to zero, finish the timed set.
   * Baseline on first observation so we do not finish on app load.
   */
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

  /**
   * Auto-start when Game.log ACCEPT or CONTRACT is acted on (live only).
   * First poll only marks seen keys so history does not start the timer.
   */
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

        if (!running) {
          startStopwatch({ auto: true });
        }
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

  function playDepositChime() {
    if (!soundEnabled) return;
    try {
      var ctx = ensureAudio();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      function beep(freq, t0, dur, gain) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain || 0.22, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      }
      beep(880, now, 0.12, 0.25);
      beep(1174.7, now + 0.14, 0.18, 0.22);
    } catch (e) {
      console.warn("[sound]", e);
    }
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

  function loadPersisted() {
    try {
      var raw = localStorage.getItem("sc_stopwatch_laps");
      if (raw) laps = JSON.parse(raw) || [];
    } catch (_) {
      laps = [];
    }
    try {
      var se = localStorage.getItem("sc_deposit_sound");
      if (se != null) soundEnabled = se === "1";
    } catch (_) {}
    try {
      var at = localStorage.getItem("sc_auto_timer");
      if (at != null) autoTimerEnabled = at === "1";
    } catch (_) {}
    var chk = $("chk-deposit-sound");
    if (chk) chk.checked = soundEnabled;
    var chkT = $("chk-auto-timer");
    if (chkT) chkT.checked = autoTimerEnabled;
    renderLaps();
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

  function testSound() {
    soundEnabled = true;
    var chk = $("chk-deposit-sound");
    if (chk) chk.checked = true;
    try {
      localStorage.setItem("sc_deposit_sound", "1");
    } catch (_) {}
    playDepositChime();
    if (typeof toast === "function") toast("Test chime");
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
  window.onAutoTimerToggle = onAutoTimerToggle;
  window.testDepositSound = testSound;
  window.playDepositChime = playDepositChime;
  window.checkStopwatchMissions = checkActiveMissionTransitions;

  function boot() {
    loadPersisted();
    setInterval(pollScanReady, 1500);
    setInterval(pollLogAccepts, 2000);
    setInterval(checkActiveMissionTransitions, 2000);
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
