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
  signaturesForClusters,
  formatClusterSignatures,
  DEFAULT_CLUSTER_MAX,
} = require("./signatures");

function createServer(options = {}) {
  const dataPath =
    options.dataPath ||
    path.join(options.userDataPath || process.cwd(), "missions.json");
  const logPath = options.logPath || null;

  const store = new MissionStore(dataPath);
  const recentCompletes = [];
  let appStatus = {
    message: "Ready",
    phase: "idle",
    updatedAt: new Date().toISOString(),
  };
  function setAppStatus(message, phase = "idle") {
    appStatus = {
      message: String(message || ""),
      phase: phase || "idle",
      updatedAt: new Date().toISOString(),
    };
  }

  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "..", "renderer")));

  function onLogEvent(ev) {
    if (ev.kind === "accept") {
      store.addOrUpdateMission(ev.mission_id, "Pending title…", ev.timestamp);
      console.log(`[log] ACCEPT  ${ev.mission_id.slice(0, 8)}…`);
    } else if (ev.kind === "contract") {
      store.addOrUpdateMission(
        ev.mission_id,
        ev.title || "Ore Scan",
        ev.timestamp
      );
      console.log(`[log] CONTRACT ${ev.mission_id.slice(0, 8)}… → ${ev.title}`);
    } else if (ev.kind === "objective") {
      const existing = store.missions[ev.mission_id];
      store.addOrUpdateMission(
        ev.mission_id,
        existing ? existing.title : "Ore Scan",
        ev.timestamp,
        ev.objective_id
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
      console.log(`[log] OBJECTIVE COMPLETE ${ev.mission_id.slice(0, 8)}…`);
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
      "Manual Ore Scan (screen OCR)";
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
    res.json(store.missions[id].toJSON());
  });

  app.get("/api/mission/:id", (req, res) => {
    const m = store.missions[req.params.id];
    if (!m) return res.status(404).json({ error: "not found" });
    res.json(m.toJSON());
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

  app.get("/api/resources", (_req, res) => {
    res.json(COMMON_RESOURCES);
  });

  app.get("/api/signatures", (_req, res) => {
    res.json(RESOURCE_SIGNATURES);
  });

  app.get("/api/stats", (_req, res) => {
    const active = store.activeScanMissions
      ? store.activeScanMissions()
      : store.activeMissions().filter((m) => isMiningScanTitle(m.title));
    const completed = Object.values(store.missions).filter(
      (m) => m.status === "completed"
    );
    const remaining = {};
    let remaining_mission_count = 0;
    for (const m of active) {
      const rem = m.remaining();
      if (Object.keys(rem).length) remaining_mission_count += 1;
      for (const [r, n] of Object.entries(rem)) {
        remaining[r] = (remaining[r] || 0) + n;
      }
    }
    const remaining_detailed = {};
    for (const [r, n] of Object.entries(remaining)) {
      const base = signatureFor(r);
      const clusters = signaturesForClusters(r, DEFAULT_CLUSTER_MAX);
      remaining_detailed[r] = {
        count: n,
        signature: base,
        signatures: clusters.map((c) => c.signature),
        clusters,
        signatures_label: formatClusterSignatures(r, DEFAULT_CLUSTER_MAX),
      };
    }
    res.json({
      active_count: active.length,
      completed_count: completed.length,
      total_missions: Object.keys(store.missions).length,
      remaining_totals: remaining,
      remaining_mission_count,
      remaining_detailed,
      signatures: RESOURCE_SIGNATURES,
      scan_events: store.scan_history.length,
      ocr_available: true,
      ocr_backend: "tesseract.js (browser CDN)",
      log_path: currentLogPath,
      status: appStatus,
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
      resources: COMMON_RESOURCES,
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
