"use strict";

const fs = require("fs");
const path = require("path");

const COMMON_RESOURCES = [
  "Aluminium", "Bexalite", "Copper", "Gold", "Hadanite", "Ice", "Iron",
  "Laranite", "Quantanium", "Savrillium", "Taranite", "Titanium", "Torite",
  "Agricium", "Hephaestanite",
];

/** Battaglia ore-scan style missions only (title keywords) */
function isMiningScanTitle(title) {
  const s = String(title || "").toLowerCase();
  return /mining|scan|ore/.test(s);
}

class Mission {
  constructor(data = {}) {
    this.mission_id = data.mission_id || "";
    this.title = data.title || "Unknown Ore Scan";
    this.accepted_at = data.accepted_at || new Date().toISOString();
    this.status = data.status || "active";
    this.requirements = data.requirements || {};
    this.progress = data.progress || {};
    this.objective_ids = data.objective_ids || [];
    this.notes = data.notes || "";
    this.completed_at = data.completed_at || null;
  }

  remaining() {
    const out = {};
    for (const [r, need] of Object.entries(this.requirements || {})) {
      const have = this.progress[r] || 0;
      const left = Math.max(0, need - have);
      if (left > 0) out[r] = left;
    }
    return out;
  }

  isFullyComplete() {
    const keys = Object.keys(this.requirements || {});
    if (!keys.length) return false;
    return keys.every((r) => (this.progress[r] || 0) >= (this.requirements[r] || 0));
  }

  applyScan(resource, count = 1) {
    if (!resource || this.status !== "active") return 0;
    const need = this.requirements[resource];
    if (need == null) return 0;
    const have = this.progress[resource] || 0;
    const room = Math.max(0, need - have);
    const applied = Math.min(room, Math.max(0, count));
    if (applied <= 0) return 0;
    this.progress[resource] = have + applied;
    if (this.isFullyComplete() && this.status === "active") {
      this.status = "completed";
      this.completed_at = new Date().toISOString();
    }
    return applied;
  }

  toJSON() {
    return {
      mission_id: this.mission_id,
      title: this.title,
      accepted_at: this.accepted_at,
      status: this.status,
      requirements: this.requirements,
      progress: this.progress,
      objective_ids: this.objective_ids,
      notes: this.notes,
      completed_at: this.completed_at,
      remaining: this.remaining(),
    };
  }
}

class MissionStore {
  constructor(filePath) {
    this.path = filePath;
    this.missions = {};
    this.scan_history = [];
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.path)) return;
      const data = JSON.parse(fs.readFileSync(this.path, "utf8"));
      this.missions = {};
      for (const [id, m] of Object.entries(data.missions || {})) {
        this.missions[id] = new Mission(m);
      }
      this.scan_history = data.scan_history || [];
    } catch (e) {
      console.error("[store] load failed:", e.message);
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      const data = {
        missions: {},
        scan_history: this.scan_history.slice(-200),
      };
      for (const [id, m] of Object.entries(this.missions)) {
        data.missions[id] = m.toJSON();
      }
      fs.writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.error("[store] save failed:", e.message);
    }
  }

  addOrUpdateMission(missionId, title, acceptedAt, objectiveId = null) {
    if (this.missions[missionId]) {
      const m = this.missions[missionId];
      if (objectiveId && !m.objective_ids.includes(objectiveId)) {
        m.objective_ids.push(objectiveId);
      }
      if (title && title !== m.title && !title.includes("Contract Accepted")) {
        m.title = title;
      }
      return m;
    }
    const m = new Mission({
      mission_id: missionId,
      title: title || "Unknown Ore Scan",
      accepted_at: acceptedAt,
      objective_ids: objectiveId ? [objectiveId] : [],
    });
    this.missions[missionId] = m;
    this.save();
    return m;
  }

  setRequirements(missionId, requirements) {
    const m = this.missions[missionId];
    if (!m) return false;
    const cleaned = {};
    for (const [k, v] of Object.entries(requirements || {})) {
      const n = parseInt(v, 10);
      if (n > 0) cleaned[k] = n;
    }
    m.requirements = cleaned;
    for (const r of Object.keys(m.requirements)) {
      if (m.progress[r] == null) m.progress[r] = 0;
    }
    if (m.isFullyComplete()) {
      m.status = "completed";
      m.completed_at = m.completed_at || new Date().toISOString();
    }
    this.save();
    return true;
  }

  applyOcrState(missionId, requirements, progress) {
    const m = this.missions[missionId];
    if (!m) return false;
    if (requirements && Object.keys(requirements).length) {
      const cleaned = {};
      for (const [k, v] of Object.entries(requirements)) {
        const n = parseInt(v, 10);
        if (n > 0) cleaned[k] = n;
      }
      m.requirements = { ...m.requirements, ...cleaned };
    }
    if (progress && Object.keys(progress).length) {
      for (const [k, v] of Object.entries(progress)) {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && n >= 0) m.progress[k] = n;
      }
    }
    for (const r of Object.keys(m.requirements)) {
      if (m.progress[r] == null) m.progress[r] = 0;
    }
    if (m.isFullyComplete() && m.status === "active") {
      m.status = "completed";
      m.completed_at = new Date().toISOString();
    }
    this.save();
    return true;
  }

  recordScan(resource, count = 1, note = "") {
    const applied = {};
    const newlyCompleted = [];
    for (const [mid, m] of Object.entries(this.missions)) {
      if (m.status !== "active") continue;
      if (!isMiningScanTitle(m.title)) continue;
      const n = m.applyScan(resource, count);
      if (n > 0) {
        applied[mid] = n;
        if (m.status === "completed") newlyCompleted.push(mid);
      }
    }
    const event = {
      timestamp: new Date().toISOString(),
      resource,
      count,
      applied_to: Object.keys(applied),
      note,
    };
    this.scan_history.push(event);
    this.save();
    return {
      resource,
      count,
      applied,
      newly_completed: newlyCompleted,
      event,
    };
  }

  markObjectiveComplete(missionId, objectiveId) {
    const m = this.missions[missionId];
    if (!m) return;
    if (objectiveId && !m.objective_ids.includes(objectiveId)) {
      m.objective_ids.push(objectiveId);
    }
    this.save();
  }

  setStatus(missionId, status) {
    const m = this.missions[missionId];
    if (!m) return false;
    m.status = status;
    if (status === "completed" && !m.completed_at) {
      m.completed_at = new Date().toISOString();
    }
    this.save();
    return true;
  }

  activeMissions() {
    return Object.values(this.missions).filter((m) => m.status === "active");
  }

  activeScanMissions() {
    return this.activeMissions().filter((m) => isMiningScanTitle(m.title));
  }

  allMissions() {
    return Object.values(this.missions).sort(
      (a, b) => (b.accepted_at || "").localeCompare(a.accepted_at || "")
    );
  }
}

module.exports = { MissionStore, Mission, COMMON_RESOURCES, isMiningScanTitle };
