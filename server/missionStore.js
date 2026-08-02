"use strict";

const fs = require("fs");
const path = require("path");

const COMMON_RESOURCES = [
  "Agricium", "Aluminium", "Aslarite", "Beryl", "Bexalite", "Borase",
  "Copper", "Corundum", "Gold", "Hephaestanite", "Ice", "Iron",
  "Laranite", "Lindinium", "Ouratite", "Quantanium", "Quartz", "Riccite",
  "Savrilium", "Silicon", "Stileron", "Taranite", "Tin", "Titanium",
  "Torite", "Tungsten",
];

function isMiningScanTitle(title) {
  const s = String(title || "").toLowerCase();
  if (/ocr|screen/.test(s)) return true;
  return /mining|scan|ore|gathering/.test(s);
}

function formatDuration(ms) {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  if (h > 0) return pad(h) + ":" + pad(m) + ":" + pad(s);
  return pad(m) + ":" + pad(s);
}

function computeDurationMs(acceptedAt, completedAt) {
  try {
    const a = Date.parse(acceptedAt);
    const c = Date.parse(completedAt);
    if (Number.isNaN(a) || Number.isNaN(c) || c < a) return null;
    return c - a;
  } catch (_) {
    return null;
  }
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
    this.duration_ms =
      data.duration_ms != null
        ? data.duration_ms
        : computeDurationMs(this.accepted_at, this.completed_at);
    this.resource_completed_at = data.resource_completed_at || {};
    this.resource_duration_ms = data.resource_duration_ms || {};
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

  markResourceComplete(resource, at) {
    if (!resource) return;
    if (this.resource_completed_at[resource]) return;
    const when = at || new Date().toISOString();
    this.resource_completed_at[resource] = when;
    this.resource_duration_ms[resource] = computeDurationMs(
      this.accepted_at,
      when
    );
  }

  syncResourceCompletions(at) {
    const when = at || new Date().toISOString();
    for (const [r, need] of Object.entries(this.requirements || {})) {
      const have = this.progress[r] || 0;
      if (need > 0 && have >= need) {
        this.markResourceComplete(r, when);
      }
    }
  }

  /** Fill progress up to requirements for any shortfall (used on log complete). */
  fillRemainingProgress(at) {
    const when = at || new Date().toISOString();
    const credited = {};
    for (const [r, need] of Object.entries(this.requirements || {})) {
      const n = parseInt(need, 10) || 0;
      if (n <= 0) continue;
      const have = this.progress[r] || 0;
      const gap = Math.max(0, n - have);
      if (gap > 0) {
        this.progress[r] = have + gap;
        credited[r] = gap;
      }
      if ((this.progress[r] || 0) >= n) {
        this.markResourceComplete(r, when);
      }
    }
    return credited;
  }

  markCompleted(at) {
    if (this.status === "completed" && this.completed_at && this.duration_ms != null) {
      this.syncResourceCompletions(this.completed_at);
      return;
    }
    this.status = "completed";
    this.completed_at = at || this.completed_at || new Date().toISOString();
    this.duration_ms = computeDurationMs(this.accepted_at, this.completed_at);
    this.syncResourceCompletions(this.completed_at);
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
    if (this.progress[resource] >= need) {
      this.markResourceComplete(resource, new Date().toISOString());
    }
    if (this.isFullyComplete() && this.status === "active") {
      this.markCompleted(new Date().toISOString());
    }
    return applied;
  }

  toJSON() {
    const duration_ms =
      this.duration_ms != null
        ? this.duration_ms
        : computeDurationMs(this.accepted_at, this.completed_at);
    const resource_duration_label = {};
    for (const [r, ms] of Object.entries(this.resource_duration_ms || {})) {
      resource_duration_label[r] = formatDuration(ms);
    }
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
      duration_ms,
      duration_label: formatDuration(duration_ms),
      resource_completed_at: this.resource_completed_at,
      resource_duration_ms: this.resource_duration_ms,
      resource_duration_label,
      remaining: this.remaining(),
    };
  }
}

class MissionStore {
  constructor(filePath) {
    this.path = filePath;
    this.missions = {};
    this.scan_history = [];
    /** Serialize completeFromLog so rapid MissionEnded bursts stay ordered. */
    this._completeFromLogQueue = Promise.resolve();
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
        scan_history: this.scan_history.slice(-500),
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
    m.syncResourceCompletions();
    if (m.isFullyComplete()) {
      m.markCompleted(m.completed_at || new Date().toISOString());
    }
    this.save();
    return true;
  }

  addRequirement(missionId, resource, count = 1) {
    const m = this.missions[missionId];
    if (!m) return false;
    const name = String(resource || "").trim();
    const n = parseInt(count, 10);
    if (!name || !(n > 0)) return false;
    m.requirements[name] = (m.requirements[name] || 0) + n;
    if (m.progress[name] == null) m.progress[name] = 0;
    m.syncResourceCompletions();
    if (m.isFullyComplete() && m.status === "active") {
      m.markCompleted(new Date().toISOString());
    }
    this.save();
    return true;
  }

  removeRequirement(missionId, resource) {
    const m = this.missions[missionId];
    if (!m) return false;
    const name = String(resource || "").trim();
    if (!name || !(name in m.requirements)) return false;
    delete m.requirements[name];
    delete m.progress[name];
    delete m.resource_completed_at[name];
    delete m.resource_duration_ms[name];
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
    m.syncResourceCompletions();
    if (m.isFullyComplete() && m.status === "active") {
      m.markCompleted(new Date().toISOString());
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

  /**
   * MissionEnded / Contract Complete from Game.log.
   *
   * Safe for rapid successive completions:
   * 1. Snapshot this mission's shortfall only
   * 2. Fill + complete THIS mission first (removes it from active pool)
   * 3. Apply those shortfall counts as shared progress to OTHER still-active
   *    missions only (no double-count against the mission we just closed)
   *
   * Example: need 3 Iron, have 2 → credit 1 Iron to siblings, complete self.
   */
  completeFromLog(missionId, at, note = "log-complete") {
    const m = this.missions[missionId];
    if (!m) return { ok: false, credited: {}, already_done: false };

    const when = at || new Date().toISOString();
    if (m.status === "completed") {
      return { ok: true, credited: {}, already_done: true };
    }

    // Snapshot shortfall before mutating anything
    const shortfall = { ...m.remaining() };

    // Fill + complete this mission first so it is no longer "active"
    const credited = m.fillRemainingProgress(when);
    m.markCompleted(when);

    const sharedApplied = {};

    // Shared credit goes only to other active scan missions
    for (const [resource, count] of Object.entries(shortfall)) {
      const n = parseInt(count, 10) || 0;
      if (n <= 0) continue;

      const appliedTo = [];
      for (const [mid, other] of Object.entries(this.missions)) {
        if (mid === missionId) continue;
        if (other.status !== "active") continue;
        if (!isMiningScanTitle(other.title)) continue;
        const got = other.applyScan(resource, n);
        if (got > 0) appliedTo.push(mid);
      }

      sharedApplied[resource] = appliedTo;
      this.scan_history.push({
        timestamp: when,
        resource,
        count: n,
        applied_to: [missionId].concat(appliedTo),
        note: note + " auto-credit " + resource,
      });
    }

    // Ensure credited map reflects what we filled on this mission
    for (const [r, n] of Object.entries(credited)) {
      if (!shortfall[r]) shortfall[r] = n;
    }

    this.save();

    return {
      ok: true,
      credited: shortfall,
      shared_applied: sharedApplied,
      already_done: false,
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
    if (status === "completed") {
      m.markCompleted(m.completed_at || new Date().toISOString());
    } else {
      m.status = status;
    }
    this.save();
    return true;
  }

  deleteMission(missionId) {
    if (!this.missions[missionId]) return false;
    delete this.missions[missionId];
    this.save();
    return true;
  }

  clearCompleted() {
    let n = 0;
    for (const id of Object.keys(this.missions)) {
      if (this.missions[id].status === "completed") {
        delete this.missions[id];
        n += 1;
      }
    }
    if (n) this.save();
    return n;
  }

  scanStats() {
    const byResource = {};
    let totalEvents = 0;
    let totalUnits = 0;
    for (const e of this.scan_history) {
      totalEvents += 1;
      const r = e.resource || "Unknown";
      const c = parseInt(e.count, 10) || 0;
      totalUnits += c;
      if (!byResource[r]) byResource[r] = { events: 0, units: 0 };
      byResource[r].events += 1;
      byResource[r].units += c;
    }
    return { total_events: totalEvents, total_units: totalUnits, by_resource: byResource };
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

module.exports = {
  MissionStore,
  Mission,
  COMMON_RESOURCES,
  isMiningScanTitle,
  formatDuration,
};
