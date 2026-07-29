"use strict";

const fs = require("fs");

const ACCEPT_RE =
  /<CommsNotifications>.*ReccoBattaglia.*MissionAccept.*Mission:\s*\[([0-9a-f-]{36})\].*Player:/i;
const CONTRACT_RE =
  /Added notification "Contract Accepted:\s*(.+?)\s*<EM4>[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\]/i;
const CONTRACT_RE_FALLBACK =
  /Added notification "Contract Accepted:\s*(.+?)\s*<EM4>/i;
const OBJECTIVE_RE =
  /<ObjectiveUpserted>.*mission_id\s+([0-9a-f-]{36})\s+-\s+objective_id\s+([0-9a-f-]{36})\s+-\s+state\s+(MISSION_OBJECTIVE_STATE_\w+)/i;
const NEW_OBJ_RE =
  /Added notification "New Objective: Scan Asteroids[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\].*?ObjectiveId:\s*\[([0-9a-f-]{36})\]/i;
const OBJ_COMPLETE_RE =
  /Added notification "Objective Complete: Scan Asteroids[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\].*?ObjectiveId:\s*\[([0-9a-f-]{36})\]/i;
const MISSION_ENDED_RE =
  /<MissionEnded>.*mission_id\s+([0-9a-f-]{36})\s+-\s+mission_state\s+(\w+)/i;
const CONTRACT_COMPLETE_RE =
  /Added notification "Contract Complete:\s*(.+?)\s*<EM4>[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\]/i;
const MINERAL_DEPOSIT_RE = /Mineral deposit detected/i;
const TIMESTAMP_RE = /^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)>/;

function extractTs(line) {
  const m = line.match(TIMESTAMP_RE);
  return m ? m[1] : new Date().toISOString();
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

class LogParser {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.pendingAcceptId = null;
    this.lastPos = 0;
    /** When false, skip noisy live-only events (mineral deposit). */
    this.live = false;
  }

  processLine(line) {
    line = line.replace(/\n$/, "");
    if (!line) return null;

    let m = line.match(ACCEPT_RE);
    if (m) {
      const ev = {
        kind: "accept",
        timestamp: extractTs(line),
        mission_id: m[1],
        raw: line.slice(0, 400),
      };
      this.pendingAcceptId = m[1];
      this.onEvent(ev);
      return ev;
    }

    m = line.match(CONTRACT_RE);
    if (m) {
      const title = cleanTitle(m[1]);
      const mid = m[2];
      this.pendingAcceptId = null;
      const ev = {
        kind: "contract",
        timestamp: extractTs(line),
        mission_id: mid,
        title,
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    m = line.match(CONTRACT_RE_FALLBACK);
    if (m && this.pendingAcceptId) {
      const title = cleanTitle(m[1]);
      const ev = {
        kind: "contract",
        timestamp: extractTs(line),
        mission_id: this.pendingAcceptId,
        title,
        raw: line.slice(0, 400),
      };
      this.pendingAcceptId = null;
      this.onEvent(ev);
      return ev;
    }

    m = line.match(MISSION_ENDED_RE);
    if (m) {
      const ev = {
        kind: "mission_ended",
        timestamp: extractTs(line),
        mission_id: m[1],
        state: m[2],
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    m = line.match(CONTRACT_COMPLETE_RE);
    if (m) {
      const ev = {
        kind: "contract_complete",
        timestamp: extractTs(line),
        mission_id: m[2],
        title: cleanTitle(m[1]),
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    m = line.match(OBJECTIVE_RE);
    if (m) {
      const state = m[3];
      const kind = /COMPLETED/i.test(state)
        ? "objective_complete"
        : "objective";
      const ev = {
        kind,
        timestamp: extractTs(line),
        mission_id: m[1],
        objective_id: m[2],
        state,
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    m = line.match(NEW_OBJ_RE);
    if (m) {
      const ev = {
        kind: "objective",
        timestamp: extractTs(line),
        mission_id: m[1],
        objective_id: m[2],
        state: "MISSION_OBJECTIVE_STATE_INPROGRESS",
        label: "Scan Asteroids",
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    m = line.match(OBJ_COMPLETE_RE);
    if (m) {
      const ev = {
        kind: "objective_complete",
        timestamp: extractTs(line),
        mission_id: m[1],
        objective_id: m[2],
        state: "MISSION_OBJECTIVE_STATE_COMPLETED",
        label: "Scan Asteroids",
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    // Live only — history is full of these and would spam alerts
    if (this.live && MINERAL_DEPOSIT_RE.test(line)) {
      const ev = {
        kind: "mineral_deposit",
        timestamp: extractTs(line),
        mission_id: null,
        detail: "Mineral deposit detected — ready to scan",
        raw: line.slice(0, 400),
      };
      this.onEvent(ev);
      return ev;
    }

    return null;
  }

  parseFile(filePath) {
    const events = [];
    if (!fs.existsSync(filePath)) return events;
    this.live = false;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const ev = this.processLine(line);
      if (ev) events.push(ev);
    }
    try {
      this.lastPos = fs.statSync(filePath).size;
    } catch (_) {}
    this.live = true;
    return events;
  }

  tailNewLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    this.live = true;
    const size = fs.statSync(filePath).size;
    if (size < this.lastPos) this.lastPos = 0;
    if (size === this.lastPos) return [];
    const fd = fs.openSync(filePath, "r");
    const len = size - this.lastPos;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, this.lastPos);
    fs.closeSync(fd);
    this.lastPos = size;
    const events = [];
    for (const line of buf.toString("utf8").split(/\r?\n/)) {
      const ev = this.processLine(line);
      if (ev) events.push(ev);
    }
    return events;
  }
}

module.exports = { LogParser };
