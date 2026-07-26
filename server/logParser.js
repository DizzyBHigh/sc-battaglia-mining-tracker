"use strict";

const fs = require("fs");

const ACCEPT_RE =
  /<CommsNotifications>.*ReccoBattaglia.*MissionAccept.*Mission:\s*\[([0-9a-f-]{36})\].*Player:/i;
const CONTRACT_RE =
  /Added notification "Contract Accepted:\s*(.+?)\s*<EM4>/i;
const OBJECTIVE_RE =
  /<ObjectiveUpserted>.*mission_id\s+([0-9a-f-]{36})\s+-\s+objective_id\s+([0-9a-f-]{36})\s+-\s+state\s+(MISSION_OBJECTIVE_STATE_\w+)/i;
const NEW_OBJ_RE =
  /Added notification "New Objective: Scan Asteroids[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\].*?ObjectiveId:\s*\[([0-9a-f-]{36})\]/i;
const OBJ_COMPLETE_RE =
  /Added notification "Objective Complete: Scan Asteroids[\s\S]*?MissionId:\s*\[([0-9a-f-]{36})\].*?ObjectiveId:\s*\[([0-9a-f-]{36})\]/i;
const TIMESTAMP_RE = /^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)>/;

function extractTs(line) {
  const m = line.match(TIMESTAMP_RE);
  return m ? m[1] : new Date().toISOString();
}

class LogParser {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.pendingAcceptId = null;
    this.lastPos = 0;
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
        raw: line,
      };
      this.pendingAcceptId = m[1];
      this.onEvent(ev);
      return ev;
    }

    m = line.match(CONTRACT_RE);
    if (m && this.pendingAcceptId) {
      let title = m[1].replace(/<[^>]+>/g, "").trim();
      const ev = {
        kind: "contract",
        timestamp: extractTs(line),
        mission_id: this.pendingAcceptId,
        title,
        raw: line,
      };
      this.pendingAcceptId = null;
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
        raw: line,
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
        raw: line,
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
        raw: line,
      };
      this.onEvent(ev);
      return ev;
    }

    return null;
  }

  parseFile(filePath) {
    const events = [];
    if (!fs.existsSync(filePath)) return events;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const ev = this.processLine(line);
      if (ev) events.push(ev);
    }
    try {
      this.lastPos = fs.statSync(filePath).size;
    } catch (_) {}
    return events;
  }

  tailNewLines(filePath) {
    const events = [];
    if (!fs.existsSync(filePath)) return events;
    const size = fs.statSync(filePath).size;
    if (size < this.lastPos) this.lastPos = 0;
    const fd = fs.openSync(filePath, "r");
    try {
      const len = size - this.lastPos;
      if (len <= 0) return events;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.lastPos);
      this.lastPos = size;
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const ev = this.processLine(line);
        if (ev) events.push(ev);
      }
    } finally {
      fs.closeSync(fd);
    }
    return events;
  }
}

module.exports = { LogParser };
