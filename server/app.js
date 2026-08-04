"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const { MissionStore, COMMON_RESOURCES, isMiningScanTitle } = require("./missionStore");
const { LogParser } = require("./logParser");
const { parseRequirements, parseOcrResult } = require("./ocrParse");
const {
  RESOURCE_SIGNATURES,
  signatureFor,
  clusterMaxFor,
  signaturesForClusters,
  formatClusterSignatures,
  DEFAULT_CLUSTER_MAX,
} = require("./signatures");

const MUTED_PLAYER_NAMES = new Set(["olaria"]);

function listResources() {
  const skip = new Set(["Aluminum", "Quantainium", "Savrillium"]);
  const fromSig = Object.keys(RESOURCE_SIGNATURES || {}).filter((k) => !skip.has(k));
  const set = new Set([...(COMMON_RESOURCES || []), ...fromSig]);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function formatCredited(credited) {
  const parts = Object.entries(credited || {})
    .filter(([, n]) => n > 0)
    .map(([r, n]) => n + "x " + r);
  return parts.length ? parts.join(", ") : "";
}

function createServer(options = {}) {
  const dataPath =
    options.dataPath ||
    path.join(options.userDataPath || process.cwd(), "missions.json");
  const logPath = options.logPath || null;

  const store = new MissionStore(dataPath);
  const recentCompletes = [];
  const actedLog = [];
  const ACTED_LOG_MAX = 200;
  const scanReadyAlerts = [];
  const SCAN_READY_MAX = 30;

  let playerName = null;
  let playerMuted = false;

  function notePlayer(name) {
    if (!name) return;
    const cleaned = String(name).trim();
    if (!cleaned) return;
    playerName = cleaned;
    if (MUTED_PLAYER_NAMES.has(cleaned.toLowerCase())) {
      if (!playerMuted) {
        playerMuted = true;
        console.log("[player] MUTED:", cleaned);
        pushActed(
          { kind: "player", timestamp: new Date().toISOString(), title: cleaned },
          "MUTED",
          "Player " + cleaned + " is muted — app locked"
        );
      } else {
        playerMuted = true;
      }
    }
  }

  let appStatus = {
    message: "Ready",
    phase: "idle",
    updatedAt: new Date().toISOString(),
  };
  let statusClearTimer = null;

  function pushActed(ev, action, detail) {
    const entry = {
      id: actedLog.length + 1,
      timestamp: ev.timestamp || new Date().toISOString(),
      kind: ev.kind,
      action: action || ev.kind,
      mission_id: ev.mission_id || null,
      objective_id: ev.objective_id || null,
      title: ev.title || null,
      detail: detail || null,
      raw: (ev.raw || "").slice(0, 280),
    };
    actedLog.push(entry);
    if (actedLog.length > ACTED_LOG_MAX) actedLog.splice(0, actedLog.length - ACTED_LOG_MAX);
    return entry;
  }

  function setAppStatus(message, phase = "idle") {
    const msg = String(message || "Ready");
    const ph = phase || "idle";
    const ts = new Date().toISOString();
    appStatus = {
      message: msg,
      phase: ph,
      updatedAt: ts,
    };

    const isBaseline = (msg === "Ready" || !msg) && (ph === "idle" || !ph);
    if (!isBaseline) {
      pushActed(
        { kind: "overlay", timestamp: ts },
        "OVERLAY",
        msg + (ph && ph !== "idle" ? " [" + ph + "]" : "")
      );
    }

    if (statusClearTimer) {
      clearTimeout(statusClearTimer);
      statusClearTimer = null;
    }
    if (!isBaseline) {
      statusClearTimer = setTimeout(() => {
        statusClearTimer = null;
        appStatus = {
          message: "Ready",
          phase: "idle",
          updatedAt: new Date().toISOString(),
        };
      }, 5000);
    }
  }

  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "..", "renderer")));

  function onLogEvent(ev) {
    if (ev.player) notePlayer(ev.player);
    if (ev.kind === "player") {
      notePlayer(ev.player);
      return;
    }

    if (ev.kind === "accept") {
      store.addOrUpdateMission(ev.mission_id, "Ore Scan (accepted)", ev.timestamp);
      pushActed(ev, "ACCEPT", "Created mission card Ore Scan (accepted)");
      console.log(`[log] ACCEPT  ${ev.mission_id.slice(0, 8)}…`);
    } else if (ev.kind === "contract") {
      store.addOrUpdateMission(
        ev.mission_id,
        ev.title || "Ore Scan",
        ev.timestamp
      );
      pushActed(ev, "CONTRACT", "Title → " + (ev.title || "Ore Scan"));
      console.log(`[log] CONTRACT ${ev.mission_id.slice(0, 8)}… → ${ev.title}`);
    } else if (ev.kind === "objective") {
      const existing = store.missions[ev.mission_id];
      store.addOrUpdateMission(
        ev.mission_id,
        existing ? existing.title : "Ore Scan",
        ev.timestamp,
        ev.objective_id
      );
      pushActed(
        ev,
        "OBJECTIVE",
        (ev.label || "objective") + " " + (ev.state || "INPROGRESS")
      );
    } else if (ev.kind === "objective_complete") {
      store.markObjectiveComplete(ev.mission_id, ev.objective_id || "");
      const title = store.missions[ev.mission_id]
        ? store.missions[ev.mission_id].title
        : "";
      recentCompletes.push({
        timestamp: ev.timestamp,
        mission_id: ev.mission_id,
        objective_id: ev.objective_id,
        title,
      });
      if (recentCompletes.length > 100) recentCompletes.splice(0, 50);
      pushActed(ev, "OBJ COMPLETE", (ev.label || "objective") + " completed");
      console.log(`[log] OBJECTIVE COMPLETE ${ev.mission_id.slice(0, 8)}…`);
    } else if (ev.kind === "mission_ended") {
      const mid = ev.mission_id;
      const completed = /COMPLETED/i.test(ev.state || "");
      if (completed && store.missions[mid]) {
        const result = store.completeFromLog
          ? store.completeFromLog(mid, ev.timestamp, "mission-ended")
          : (store.setStatus(mid, "completed"), { credited: {} });
        const m = store.missions[mid];
        const dur = m && m.toJSON ? m.toJSON().duration_label : null;
        const credit = formatCredited(result && result.credited);
        pushActed(
          ev,
          "MISSION ENDED",
          "Auto-completed" +
            (dur ? " in " + dur : "") +
            (credit ? " · credited " + credit : "")
        );
        console.log(
          `[log] MISSION ENDED ${mid.slice(0, 8)}… → completed` +
            (credit ? " (+" + credit + ")" : "")
        );
      } else if (completed) {
        pushActed(ev, "MISSION ENDED", "Completed (mission not tracked)");
        console.log(`[log] MISSION ENDED ${mid.slice(0, 8)}… (not in store)`);
      } else {
        pushActed(ev, "MISSION ENDED", "State " + (ev.state || "?"));
      }
    } else if (ev.kind === "contract_complete") {
      const mid = ev.mission_id;
      if (store.missions[mid]) {
        if (ev.title && store.missions[mid].title !== ev.title) {
          store.missions[mid].title = ev.title;
        }
        const result = store.completeFromLog
          ? store.completeFromLog(mid, ev.timestamp, "contract-complete")
          : (store.setStatus(mid, "completed"), { credited: {} });
        const m = store.missions[mid];
        const dur = m && m.toJSON ? m.toJSON().duration_label : null;
        const credit = formatCredited(result && result.credited);
        pushActed(
          ev,
          "CONTRACT COMPLETE",
          "Auto-completed: " +
            (ev.title || "") +
            (dur ? " in " + dur : "") +
            (credit ? " · credited " + credit : "")
        );
        console.log(
          `[log] CONTRACT COMPLETE ${mid.slice(0, 8)}… → ${ev.title}` +
            (credit ? " (+" + credit + ")" : "")
        );
      } else {
        pushActed(ev, "CONTRACT COMPLETE", "Not tracked: " + (ev.title || ""));
        console.log(`[log] CONTRACT COMPLETE ${mid.slice(0, 8)}… (not in store)`);
      }
    } else if (ev.kind === "mineral_deposit") {
      const alert = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        timestamp: ev.timestamp || new Date().toISOString(),
        message: ev.detail || "Mineral deposit detected — ready to scan",
      };
      scanReadyAlerts.push(alert);
      if (scanReadyAlerts.length > SCAN_READY_MAX) {
        scanReadyAlerts.splice(0, scanReadyAlerts.length - SCAN_READY_MAX);
      }
      pushActed(ev, "DEPOSIT", alert.message);
      setAppStatus(alert.message, "scan_ready");
      console.log("[log] MINERAL DEPOSIT detected");
    }
  }

  const parser = new LogParser(onLogEvent);
  let watchTimer = null;
  let currentLogPath = logPath;

  function startWatching(filePath) {
    currentLogPath = filePath;
    if (watchTimer) clearInterval(watchTimer);
    if (!filePath) return;

    console.log(`[watcher] Parsing: ${filePath}`);
    try {
      if (fs.existsSync(filePath)) {
        const events = parser.parseFile(filePath);
        console.log(`[watcher] Found ${events.length} events in history`);
      }
    } catch (e) {
      console.error("[watcher] initial parse:", e.message);
    }

    watchTimer = setInterval(() => {
      try {
        if (currentLogPath && fs.existsSync(currentLogPath)) {
          parser.tailNewLines(currentLogPath);
        }
      } catch (e) {
        console.error("[watcher] tail:", e.message);
      }
    }, 1500);
  }

  if (logPath) startWatching(logPath);

  app.get("/api/player", (_req, res) => {
    res.json({
      name: playerName,
      muted: playerMuted,
      mute_reason: playerMuted
        ? "Sorry, Olaria, you are muted."
        : null,
    });
  });

  app.get("/api/missions", (req, res) => {
    const activeOnly = req.query.active === "1";
    const list = activeOnly ? store.activeMissions() : store.allMissions();
    res.json(list.map((m) => m.toJSON()));
  });

  app.post("/api/missions/manual", (req, res) => {
    const crypto = require("crypto");
    const body = req.body || {};
    const id = body.mission_id || crypto.randomUUID();
    const title =
      (body.title && String(body.title).trim()) ||
      "Manual Ore Scan";
    const m = store.addOrUpdateMission(
      id,
      title,
      body.accepted_at || new Date().toISOString()
    );
    if (body.requirements && typeof body.requirements === "object") {
      store.setRequirements(id, body.requirements);
    }
    if (body.progress && store.applyOcrState) {
      store.applyOcrState(id, body.requirements || null, body.progress);
    }
    pushActed(
      { kind: "accept", mission_id: id, timestamp: new Date().toISOString(), title },
      "MANUAL CREATE",
      "Manual mission card: " + title
    );
    res.json(store.missions[id].toJSON());
  });

  app.post("/api/missions/clear-completed", (_req, res) => {
    const n = store.clearCompleted();
    res.json({ ok: true, removed: n });
  });

  app.get("/api/mission/:id", (req, res) => {
    const m = store.missions[req.params.id];
    if (!m) return res.status(404).json({ error: "not found" });
    res.json(m.toJSON());
  });

  app.delete("/api/mission/:id", (req, res) => {
    const id = req.params.id;
    if (!store.missions[id]) return res.status(404).json({ error: "not found" });
    store.deleteMission(id);
    res.json({ ok: true, mission_id: id });
  });

  app.post("/api/mission/:id/requirement", (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const resource = body.resource;
    const count = parseInt(body.count, 10) || 1;
    if (!resource) return res.status(400).json({ error: "resource required" });
    if (!store.missions[id]) return res.status(404).json({ error: "not found" });
    const ok = store.addRequirement(id, resource, count);
    if (!ok) return res.status(400).json({ error: "could not add requirement" });
    res.json(store.missions[id].toJSON());
  });

  app.post("/api/mission/:id/requirement/remove", (req, res) => {
    const id = req.params.id;
    const resource = (req.body && req.body.resource) || "";
    if (!resource) return res.status(400).json({ error: "resource required" });
    if (!store.missions[id]) return res.status(404).json({ error: "not found" });
    const ok = store.removeRequirement(id, resource);
    if (!ok) return res.status(400).json({ error: "resource not on mission" });
    res.json(store.missions[id].toJSON());
  });

  app.post("/api/mission/:id", (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    if (body.requirements) store.setRequirements(id, body.requirements);
    if (body.notes != null && store.missions[id]) {
      store.missions[id].notes = String(body.notes);
      store.save();
    }
    if (body.status) store.setStatus(id, body.status);
    if (!store.missions[id]) return res.status(404).json({ error: "not found" });
    res.json(store.missions[id].toJSON());
  });

  app.post("/api/scan", (req, res) => {
    const resource = (req.body && req.body.resource) || "";
    const count = parseInt((req.body && req.body.count) || 1, 10) || 1;
    const note = (req.body && req.body.note) || "";
    if (!resource) return res.status(400).json({ error: "resource required" });
    res.json(store.recordScan(resource, count, note));
  });

  app.get("/api/recent_completes", (_req, res) => {
    res.json(recentCompletes.slice(-20));
  });

  app.get("/api/history", (_req, res) => {
    res.json(store.scan_history.slice(-50));
  });

  app.get("/api/log-events", (req, res) => {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
    res.json(actedLog.slice(-limit).reverse());
  });

  app.post("/api/log-events/clear", (_req, res) => {
    actedLog.length = 0;
    res.json({ ok: true });
  });

  app.get("/api/scan-ready", (req, res) => {
    const since = req.query.since ? String(req.query.since) : null;
    let list = scanReadyAlerts.slice();
    if (since) {
      list = list.filter((a) => a.timestamp > since || a.id > since);
    }
    res.json(list.slice(-10));
  });

  app.get("/api/resources", (_req, res) => {
    res.json(listResources());
  });

  app.get("/api/signatures", (_req, res) => {
    res.json(RESOURCE_SIGNATURES);
  });

  app.get("/api/cluster-max", (_req, res) => {
    const { CLUSTER_MAX_BY_RESOURCE } = require("./signatures");
    res.json(CLUSTER_MAX_BY_RESOURCE);
  });

  app.get("/api/stats", (_req, res) => {
    const active = store.activeScanMissions
      ? store.activeScanMissions()
      : store.activeMissions().filter((m) => isMiningScanTitle(m.title));
    const completed = Object.values(store.missions).filter(
      (m) => m.status === "completed"
    );
    const remaining_sum = {};
    const remaining_shared = {};
    const remaining_mission_by_resource = {};
    let remaining_mission_count = 0;
    for (const m of active) {
      const rem = m.remaining();
      if (Object.keys(rem).length) remaining_mission_count += 1;
      for (const [r, n] of Object.entries(rem)) {
        remaining_sum[r] = (remaining_sum[r] || 0) + n;
        remaining_shared[r] = Math.max(remaining_shared[r] || 0, n);
        remaining_mission_by_resource[r] =
          (remaining_mission_by_resource[r] || 0) + 1;
      }
    }
    const remaining = remaining_shared;
    const remaining_detailed = {};
    const allKeys = new Set([
      ...Object.keys(remaining_sum),
      ...Object.keys(remaining_shared),
    ]);
    for (const r of allKeys) {
      const base = signatureFor(r);
      const clusters = signaturesForClusters(r);
      remaining_detailed[r] = {
        count: remaining_shared[r] || 0,
        shared: remaining_shared[r] || 0,
        sum: remaining_sum[r] || 0,
        missions: remaining_mission_by_resource[r] || 0,
        signature: base,
        signatures: clusters.map((c) => c.signature),
        clusters,
        signatures_label: formatClusterSignatures(r),
        cluster_max: clusterMaxFor(r),
      };
    }
    const scanStats = store.scanStats
      ? store.scanStats()
      : {
          total_events: store.scan_history.length,
          total_units: 0,
          by_resource: {},
        };
    res.json({
      active_count: active.length,
      completed_count: completed.length,
      total_missions: Object.keys(store.missions).length,
      remaining_totals: remaining,
      remaining_shared,
      remaining_sum,
      remaining_mission_count,
      remaining_mission_by_resource,
      remaining_detailed,
      signatures: RESOURCE_SIGNATURES,
      resources: listResources(),
      scan_events: store.scan_history.length,
      scan_stats: scanStats,
      ocr_available: true,
      ocr_backend: "tesseract.js (browser CDN)",
      log_path: currentLogPath,
      status: appStatus,
      player: playerName,
      player_muted: playerMuted,
    });
  });

  app.post("/api/ocr/parse", (req, res) => {
    const text = (req.body && req.body.text) || "";
    const missionId = req.body && req.body.mission_id;
    const applyProgress = !!(req.body && req.body.apply_progress);
    if (!String(text).trim()) {
      return res.status(400).json({ error: "No OCR text provided" });
    }
    const parsed =
      typeof parseOcrResult === "function"
        ? parseOcrResult(text)
        : { requirements: parseRequirements(text), progress: {} };
    const reqs = parsed.requirements || {};
    const progress = parsed.progress || {};
    let applied = false;
    if (missionId && store.missions[missionId]) {
      if (Object.keys(reqs).length || Object.keys(progress).length) {
        if (applyProgress && store.applyOcrState) {
          store.applyOcrState(missionId, reqs, progress);
        } else if (Object.keys(reqs).length) {
          store.setRequirements(missionId, {
            ...(store.missions[missionId].requirements || {}),
            ...reqs,
          });
        }
        applied = true;
      }
    }
    res.json({
      requirements: reqs,
      progress,
      raw_text_preview: String(text).slice(0, 600),
      applied_to: applied ? missionId : null,
      applied,
    });
  });

  app.get("/api/status", (_req, res) => {
    res.json(appStatus);
  });

  app.post("/api/status", (req, res) => {
    const message = (req.body && req.body.message) || "Ready";
    const phase = (req.body && req.body.phase) || "idle";
    setAppStatus(message, phase);
    res.json(appStatus);
  });

  app.post("/api/config/log", (req, res) => {
    const p = req.body && req.body.path;
    if (!p) return res.status(400).json({ error: "path required" });
    startWatching(p);
    res.json({ ok: true, log_path: p });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      log_path: currentLogPath,
      data_path: dataPath,
      resources: listResources(),
    });
  });

  return {
    app,
    store,
    startWatching,
    getLogPath: () => currentLogPath,
  };
}

module.exports = { createServer };
