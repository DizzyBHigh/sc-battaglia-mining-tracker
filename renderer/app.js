var currentFilter = "active";
var missionsCache = [];
var seenMissionIds = new Set();
var toastTimer = null;
var autoOcrBusy = false;
var autoOcrAttempted = new Set();
var missionTitleCache = {};
var tesseractWorker = null;

var FALLBACK_RESOURCES = [
  "Agricium", "Aluminium", "Aslarite", "Beryl", "Bexalite", "Borase",
  "Copper", "Corundum", "Gold", "Hephaestanite", "Ice", "Iron",
  "Laranite", "Lindinium", "Ouratite", "Quantanium", "Quartz", "Riccite",
  "Savrilium", "Silicon", "Stileron", "Taranite", "Tin", "Titanium",
  "Torite", "Tungsten"
];

function isMiningScanTitle(title) {
  var t = String(title || "");
  if (/ocr|screen/i.test(t)) return true;
  return /mining|scan|ore|gathering/i.test(t);
}

async function pushStatus(message, phase) {
  try {
    await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, phase: phase || "idle" }),
    });
  } catch (_) {}
}

function toast(msg) {
  var existing = document.querySelector(".toast");
  if (existing) existing.remove();
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.remove(); }, 4500);
}

function setFilter(btn) {
  document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  window._missionFilter = currentFilter;
  renderMissions();
}

function escapeHtml(s) {
  var map = { "&": "&" + "amp;", "<": "&" + "lt;", ">": "&" + "gt;", '"': "&" + "quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, function (ch) { return map[ch]; });
}

function fmtTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return String(iso).slice(0, 16);
  }
}

function clusterMaxFor(resource) {
  var map = window.CLUSTER_MAX || {};
  if (map[resource] != null) return map[resource];
  var lower = String(resource || "").toLowerCase();
  for (var k in map) {
    if (k.toLowerCase() === lower) return map[k];
  }
  return 5;
}

function sigLabel(resource) {
  var sig = (window.SIGNATURES || {})[resource];
  if (sig == null) return "";
  var max = clusterMaxFor(resource);
  var parts = [];
  for (var i = 1; i <= max; i++) parts.push(sig * i);
  return " <span class=\"sig-label\" title=\"Cluster RS\">(" + parts.join(" · ") + ")</span>";
}

function normalizeResourceList(list) {
  var skip = { Aluminum: 1, Quantainium: 1, Savrillium: 1 };
  var out = [];
  var seen = {};
  (list || []).forEach(function (r) {
    if (!r || skip[r] || seen[r]) return;
    seen[r] = 1;
    out.push(r);
  });
  out.sort(function (a, b) { return a.localeCompare(b); });
  return out.length ? out : FALLBACK_RESOURCES.slice();
}

async function loadStats() {
  var r = await fetch("/api/stats");
  var s = await r.json();
  document.getElementById("stat-active").textContent = s.active_count;
  document.getElementById("stat-completed").textContent = s.completed_count;
  document.getElementById("stat-scans").textContent = s.scan_events;
  var logEl = document.getElementById("log-path-text");
  if (logEl) {
    var lp = s.log_path || "";
    logEl.textContent = lp || "(not set - click Log file...)";
    logEl.title = lp || "No Game.log selected";
  }
  if (Array.isArray(s.resources) && s.resources.length) {
    window.RESOURCES = normalizeResourceList(s.resources);
    refreshScanDropdown();
    populateAddReqControls();
  }
  var box = document.getElementById("remaining-totals");
  var rem = s.remaining_totals || {};
  var keys = Object.keys(rem).sort();
  if (!keys.length) {
    box.innerHTML = "<div class=\"empty\">No active requirements</div>";
  } else {
    var sigMap = window.SIGNATURES || {};
    var detailed = s.remaining_detailed || {};
    var missionN = s.remaining_mission_count != null ? s.remaining_mission_count : (s.active_count || 0);
    var spread = "<div class=\"empty\" style=\"margin-bottom:0.35rem;color:var(--muted)\">Across <strong style=\"color:var(--text)\">" + missionN + "</strong> mission" + (missionN === 1 ? "" : "s") + "</div>";
    box.innerHTML = spread + keys.map(function (k) {
      var n = rem[k];
      var base = (detailed[k] && detailed[k].signature != null) ? detailed[k].signature : sigMap[k];
      var cluster = (detailed[k] && detailed[k].signatures) || null;
      if (!cluster && base != null) {
        cluster = [];
        var mx = (detailed[k] && detailed[k].cluster_max) || clusterMaxFor(k);
        for (var i = 1; i <= mx; i++) cluster.push(base * i);
      }
      var sigPart = cluster && cluster.length ? " (" + cluster.join(" · ") + ")" : "";
      return "<div class=\"req-item\"><span>" + k + " <strong>" + n + "</strong><span class=\"sig-label\">" + sigPart + "</span></span></div>";
    }).join("");
  }
}

async function loadMissions() {
  var r = await fetch("/api/missions");
  missionsCache = await r.json();
  for (var j = 0; j < missionsCache.length; j++) {
    var mj = missionsCache[j];
    var prevTitle = missionTitleCache[mj.mission_id];
    if (prevTitle && prevTitle !== mj.title && !Object.keys(mj.requirements || {}).length) {
      autoOcrAttempted.delete(mj.mission_id);
    }
    missionTitleCache[mj.mission_id] = mj.title;
  }
  for (var i = 0; i < missionsCache.length; i++) {
    var m = missionsCache[i];
    if (m.status !== "active") continue;
    var isNew = !seenMissionIds.has(m.mission_id);
    if (isNew) seenMissionIds.add(m.mission_id);
    if (!isMiningScanTitle(m.title)) continue;
    if (!Object.keys(m.requirements || {}).length) {
      if (isNew || !autoOcrAttempted.has(m.mission_id)) {
        populateOcrMissionSelect();
        autoOcrForMission(m.mission_id, false);
      }
    }
  }
  renderMissions();
  populateOcrMissionSelect();
  populateAddReqControls();
  loadStats();
  loadHistory();
  checkRecentCompletes();
  loadActedLog();
}

function renderMissions() {
  var list = document.getElementById("mission-list");
  var items = missionsCache.filter(function (m) {
    if (isMiningScanTitle(m.title)) return true;
    return m.requirements && Object.keys(m.requirements).length > 0;
  });
  if (currentFilter === "active") items = items.filter(function (m) { return m.status === "active"; });
  if (currentFilter === "completed") items = items.filter(function (m) {
    return m.status === "completed" || m.status === "abandoned";
  });
  if (!items.length) {
    list.innerHTML = "<div class=\"empty\">No missions match this filter</div>";
    return;
  }
  list.innerHTML = items.map(function (m) {
    var reqs = m.requirements || {};
    var prog = m.progress || {};
    var resDurLabels = m.resource_duration_label || {};
    var keys = Object.keys(reqs).sort();
    var needsReq = keys.length === 0 && m.status === "active";
    var cls = m.status === "completed" ? "complete"
      : m.status === "abandoned" ? "abandoned"
      : needsReq ? "needs-req" : "";
    var body = "";
    if (keys.length) {
      body = "<div class=\"req-grid\">" + keys.map(function (r) {
        var need = reqs[r] || 0;
        var have = prog[r] || 0;
        var done = need > 0 && have >= need;
        var left = Math.max(0, need - have);
        var resTook = resDurLabels[r];
        var timeBit = resTook
          ? " <span class=\"sep\">|</span> Took <strong style=\"color:var(--accent)\">" + escapeHtml(resTook) + "</strong>"
          : "";
        var removeBtn = m.status === "active"
          ? " <button type=\"button\" class=\"btn btn-ghost btn-sm req-remove\" data-mid=\"" + m.mission_id +
            "\" data-res=\"" + escapeHtml(r) + "\" data-act=\"remove-req\" title=\"Remove this resource from the mission\">Remove</button>"
          : "";
        return "<div class=\"req-item " + (done ? "done" : "") + "\">" +
          "<div class=\"req-line-name\">" + escapeHtml(r) + sigLabel(r) + removeBtn + "</div>" +
          "<div class=\"req-line-stats\">Required <strong>" + need + "</strong> <span class=\"sep\">|</span> <strong>" +
          have + "</strong> Scanned <span class=\"sep\">|</span> <strong class=\"" + (left === 0 ? "ok" : "left") + "\">" +
          left + "</strong> Remaining" + timeBit + "</div></div>";
      }).join("") + "</div>";
    } else if (m.status === "active") {
      body = "<div class=\"empty\" style=\"padding:0.6rem 0\">No items to scan yet - open DETAILS and press <strong>Re-OCR</strong>, or use <strong>Add resource to mission</strong>.</div>";
    } else {
      body = "<div class=\"empty\" style=\"padding:0.5rem\">No requirements recorded</div>";
    }
    var actions = "";
    if (m.status === "active") {
      actions = "<div style=\"margin-top:0.55rem;display:flex;gap:0.4rem;flex-wrap:wrap\">" +
        "<button type=\"button\" class=\"btn btn-orange btn-sm\" data-mid=\"" + m.mission_id + "\" data-act=\"reocr\">Re-OCR</button>" +
        "<button type=\"button\" class=\"btn btn-ghost btn-sm\" data-mid=\"" + m.mission_id + "\" data-act=\"abandon\">Abandon</button></div>";
    } else if (m.status === "completed" || m.status === "abandoned") {
      actions = "<div style=\"margin-top:0.55rem;display:flex;gap:0.4rem;flex-wrap:wrap\">" +
        "<button type=\"button\" class=\"btn btn-danger btn-sm\" data-mid=\"" + m.mission_id + "\" data-act=\"delete\">Delete</button></div>";
    }
    var statusColor = m.status === "completed" ? "var(--green)"
      : m.status === "abandoned" ? "var(--muted)"
      : "var(--orange)";
    var durationBit = "";
    if (m.status === "completed" && m.duration_label) {
      durationBit = " · <strong style=\"color:var(--accent)\">took " + escapeHtml(m.duration_label) + "</strong>";
    }
    return "<div class=\"mission " + cls + "\"><div class=\"mission-header\"><div>" +
      "<div class=\"mission-title\">" + escapeHtml(m.title) + "</div>" +
      "<div class=\"mission-meta\">" + m.mission_id.slice(0, 8) + "... accepted " + fmtTime(m.accepted_at) +
      (m.completed_at ? " - done " + fmtTime(m.completed_at) : "") + durationBit + "</div></div>" +
      "<span style=\"font-size:0.75rem;color:" + statusColor + "\">" +
      m.status + "</span></div>" + body + actions + "</div>";
  }).join("");
  refreshScanDropdown();
}

document.addEventListener("click", function (ev) {
  var t = ev.target;
  var btn = t && t.closest ? t.closest("[data-act]") : null;
  if (!btn) return;
  var act = btn.getAttribute("data-act");
  var mid = btn.getAttribute("data-mid");
  if (act === "reocr" && mid) {
    if (typeof ocrThisMission === "function") ocrThisMission(mid);
    else if (typeof recaptureAndOcr === "function") recaptureAndOcr(mid, "Re-OCR");
    else autoOcrForMission(mid, true);
  } else if (act === "abandon" && mid) {
    abandon(mid);
  } else if (act === "remove-req" && mid) {
    var res = btn.getAttribute("data-res");
    if (res) removeRequirementFromMission(mid, res);
  } else if (act === "delete" && mid) {
    if (typeof deleteMission === "function") deleteMission(mid);
  }
});

async function abandon(mid) {
  var ok = await showConfirm("Mark this mission as abandoned?", {
    title: "Abandon mission",
    okText: "Abandon",
    cancelText: "Keep",
    danger: true,
  });
  if (!ok) return;
  await fetch("/api/mission/" + mid, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "abandoned" }),
  });
  loadMissions();
}

async function recordScan() {
  var resource = document.getElementById("scan-resource").value;
  var count = parseInt(document.getElementById("scan-count").value, 10) || 1;
  if (!resource) { toast("Select a resource"); return; }
  var r = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: resource, count: count }),
  });
  var data = await r.json();
  if (data.error) { toast("Error: " + data.error); return; }
  var appliedN = Object.keys(data.applied || {}).length;
  var msg = "Scanned " + count + "x " + resource + " -> applied to " + appliedN + " mission(s)";
  if (data.newly_completed && data.newly_completed.length) msg += " - " + data.newly_completed.length + " completed!";
  toast(msg);
  document.getElementById("complete-banner").style.display = "none";
  loadMissions();
}

function populateOcrMissionSelect() {
  var sel = document.getElementById("ocr-mission");
  if (!sel) return;
  var active = missionsCache.filter(function (m) { return m.status === "active" && isMiningScanTitle(m.title); });
  var cur = sel.value;
  sel.innerHTML = "<option value=\"\">- most recent active -</option>" +
    active.map(function (m) {
      return "<option value=\"" + m.mission_id + "\">" + escapeHtml(m.title).slice(0, 40) + " (" + m.mission_id.slice(0, 8) + ")</option>";
    }).join("");
  if (cur) sel.value = cur;
}

function selectedOcrMissionId() {
  var mid = document.getElementById("ocr-mission").value;
  if (mid) return mid;
  var active = missionsCache.filter(function (m) { return m.status === "active" && isMiningScanTitle(m.title); });
  return active.length ? active[0].mission_id : "";
}

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  var prog = document.getElementById("ocr-progress");
  if (prog) { prog.style.display = "block"; prog.textContent = "Downloading Tesseract.js model (first time only)..."; }
  tesseractWorker = await Tesseract.createWorker("eng", 1, {
    logger: function (m) {
      if (m.status === "recognizing text" && prog) {
        var pct = m.progress != null ? Math.round(m.progress * 100) : 0;
        prog.textContent = "Recognizing text... " + pct + "%";
      }
    },
  });
  await tesseractWorker.setParameters({ tessedit_pageseg_mode: "4" });
  return tesseractWorker;
}

async function ocrImageSource(source) {
  var box = document.getElementById("ocr-result");
  var prog = document.getElementById("ocr-progress");
  if (box) box.textContent = "";
  if (prog) { prog.style.display = "block"; prog.textContent = "Starting OCR..."; }
  await pushStatus("Performing OCR - please leave the contract screen open.", "ocr");
  try {
    var worker = await getTesseractWorker();
    if (prog) prog.textContent = "Recognizing text...";
    var result = await worker.recognize(source);
    var text = result.data.text;
    if (prog) prog.style.display = "none";
    var mid = selectedOcrMissionId();
    var r = await fetch("/api/ocr/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, mission_id: mid || null, apply_progress: true }),
    });
    var data = await r.json();
    if (data.error) {
      if (box) { box.textContent = "Error: " + data.error; box.style.color = "var(--red)"; }
      return;
    }
    var reqs = data.requirements || {};
    var keys = Object.keys(reqs);
    if (!keys.length) {
      if (box) { box.textContent = "No requirements detected."; box.style.color = "var(--orange)"; }
      return;
    }
    var summary = keys.map(function (k) { return k + "=" + reqs[k]; }).join(", ");
    if (box) box.innerHTML = "<strong class=\"ok-text\">Found:</strong> " + summary;
    toast("OCR: " + summary);
    await pushStatus("OCR complete - you can close this contract or look for a new one.", "ocr_done");
    loadMissions();
  } catch (e) {
    if (prog) prog.style.display = "none";
    if (box) { box.textContent = "OCR error: " + e; box.style.color = "var(--red)"; }
    toast("OCR failed: " + e);
  }
}

async function ocrClipboard() {
  try {
    var items = await navigator.clipboard.read();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var type = item.types.find(function (t) { return t.indexOf("image/") === 0; });
      if (type) { await ocrImageSource(await item.getType(type)); return; }
    }
    toast("Clipboard has no image.");
  } catch (e) {
    toast("Clipboard blocked - press Ctrl+V after copying a screenshot.");
  }
}

async function ocrUpload(input) {
  if (!input.files || !input.files[0]) return;
  await ocrImageSource(input.files[0]);
  input.value = "";
}

document.addEventListener("paste", async function (ev) {
  var items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf("image/") === 0) {
      ev.preventDefault();
      var file = items[i].getAsFile();
      if (file) await ocrImageSource(file);
      return;
    }
  }
});

async function loadHistory() {
  var r = await fetch("/api/history");
  var hist = await r.json();
  var box = document.getElementById("history-list");
  if (!hist.length) { box.innerHTML = "<div class=\"empty\">No scans yet</div>"; return; }
  box.innerHTML = hist.slice().reverse().slice(0, 15).map(function (e) {
    return "<div class=\"history-item\"><strong>" + e.count + "x " + e.resource + "</strong> -> " + e.applied_to.length +
      " mission(s)<br/><span style=\"font-size:0.7rem\">" + fmtTime(e.timestamp) + "</span></div>";
  }).join("");
}

async function checkRecentCompletes() {
  var r = await fetch("/api/recent_completes");
  var list = await r.json();
  if (!list.length) return;
  var latest = list[list.length - 1];
  var age = Date.now() - new Date(latest.timestamp).getTime();
  if (age < 120000) {
    document.getElementById("complete-banner").style.display = "block";
    document.getElementById("complete-msg").textContent =
      " " + list.filter(function (x) {
        return Date.now() - new Date(x.timestamp).getTime() < 120000;
      }).length + " objective(s) finished around " + fmtTime(latest.timestamp) + ".";
  }
}

async function loadActedLog() {
  try {
    var r = await fetch("/api/log-events?limit=80");
    var list = await r.json();
    var box = document.getElementById("acted-log");
    if (!box) return;
    if (!list.length) {
      box.className = "log-panel empty";
      box.textContent = "No log events acted on yet";
      return;
    }
    box.className = "log-panel";
    function tagClass(k) {
      if (k === "accept") return "accept";
      if (k === "contract") return "contract";
      if (k === "objective") return "objective";
      if (k === "objective_complete") return "obj_complete";
      if (k === "mission_ended") return "mission_ended";
      if (k === "contract_complete") return "contract_complete";
      return "objective";
    }
    box.innerHTML = list.map(function (e) {
      var mid = e.mission_id ? e.mission_id.slice(0, 8) : "-";
      var t = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
      var action = String(e.action || e.kind || "").replace(/_/g, " ");
      return "<div class=\"log-event\"><span class=\"tag " + tagClass(e.kind) + "\">" + escapeHtml(action) +
        "</span> <span class=\"ts\">" + t + "</span> <span class=\"mid\">" + mid +
        "</span> <span class=\"detail\">" + escapeHtml(e.detail || e.title || "") + "</span></div>";
    }).join("");
  } catch (err) {
    console.error(err);
  }
}

async function clearActedLog() {
  await fetch("/api/log-events/clear", { method: "POST" });
  loadActedLog();
}

async function removeRequirementFromMission(mid, resource) {
  if (!mid || !resource) return;
  var ok = await showConfirm("Remove " + resource + " from this mission?", {
    title: "Remove resource",
    okText: "Remove",
    cancelText: "Cancel",
    danger: true,
  });
  if (!ok) return;
  var r = await fetch("/api/mission/" + mid + "/requirement/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: resource }),
  });
  var data = await r.json();
  if (data.error) { toast("Error: " + data.error); return; }
  toast("Removed " + resource + " from mission");
  loadMissions();
}

async function addRequirementToMission() {
  var mid = document.getElementById("add-req-mission").value;
  var resource = document.getElementById("add-req-resource").value;
  var count = parseInt(document.getElementById("add-req-count").value, 10) || 1;
  if (!mid) { toast("Select an active mission"); return; }
  if (!resource) { toast("Select a resource"); return; }
  if (count < 1) { toast("Count must be at least 1"); return; }
  var r = await fetch("/api/mission/" + mid + "/requirement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: resource, count: count }),
  });
  var data = await r.json();
  if (data.error) { toast("Error: " + data.error); return; }
  toast("Added " + count + "x " + resource + " to mission");
  document.getElementById("add-req-count").value = "1";
  loadMissions();
}

async function createManualMission() {
  var titleEl = document.getElementById("manual-mission-title");
  var title = (titleEl && titleEl.value.trim()) || "Manual Ore Scan";
  if (!/mining|scan|ore|gathering|manual|ocr|screen/i.test(title)) {
    title = "Manual Ore Scan: " + title;
  }
  var r = await fetch("/api/missions/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title }),
  });
  var data = await r.json();
  if (data.error) { toast("Error: " + data.error); return; }
  if (data.mission_id) seenMissionIds.add(data.mission_id);
  toast("Created mission card: " + (data.title || title));
  if (titleEl) titleEl.value = "Manual Ore Scan";
  loadMissions();
}

function populateAddReqControls() {
  var resSel = document.getElementById("add-req-resource");
  var misSel = document.getElementById("add-req-mission");
  if (resSel) {
    var prev = resSel.value;
    var all = window.RESOURCES && window.RESOURCES.length ? window.RESOURCES : FALLBACK_RESOURCES;
    resSel.innerHTML = all.map(function (r) {
      var sig = (window.SIGNATURES || {})[r];
      var label = sig != null ? r + " (" + sig + ")" : r;
      return "<option value=\"" + r + "\">" + label + "</option>";
    }).join("");
    if (prev && all.indexOf(prev) >= 0) resSel.value = prev;
  }
  if (misSel) {
    var prevM = misSel.value;
    var active = missionsCache.filter(function (m) {
      return m.status === "active" && isMiningScanTitle(m.title);
    });
    misSel.innerHTML = "<option value=\"\">— select mission —</option>" +
      active.map(function (m) {
        return "<option value=\"" + m.mission_id + "\">" + escapeHtml((m.title || "").slice(0, 42)) +
          " (" + m.mission_id.slice(0, 8) + ")</option>";
      }).join("");
    if (prevM) misSel.value = prevM;
  }
}

async function initResources() {
  window.RESOURCES = FALLBACK_RESOURCES.slice();
  window.SIGNATURES = {};
  window.CLUSTER_MAX = {
    Quantanium: 2, Stileron: 2, Savrilium: 2, Ouratite: 3, Riccite: 3, Lindinium: 3,
    Beryl: 4, Taranite: 4, Borase: 4, Gold: 4, Bexalite: 4,
    Laranite: 5, Aslarite: 5, Titanium: 5, Tungsten: 5, Agricium: 5, Torite: 5,
    Hephaestanite: 6, Tin: 6, Quartz: 6, Corundum: 6, Copper: 6, Silicon: 6,
    Iron: 6, Aluminium: 6, Ice: 6
  };
  try {
    var res = await fetch("/api/resources");
    if (res.ok) {
      var list = await res.json();
      window.RESOURCES = normalizeResourceList(Array.isArray(list) ? list : FALLBACK_RESOURCES);
    }
  } catch (e) {
    console.warn("[resources] using fallback list", e);
  }
  try {
    var sigRes = await fetch("/api/signatures");
    if (sigRes.ok) window.SIGNATURES = await sigRes.json();
  } catch (_) {}
  try {
    var cm = await fetch("/api/cluster-max");
    if (cm.ok) window.CLUSTER_MAX = await cm.json();
  } catch (_) {}
  refreshScanDropdown();
  populateAddReqControls();
}

function refreshScanDropdown() {
  var sel = document.getElementById("scan-resource");
  if (!sel) return;
  var prev = sel.value;
  var needed = {};
  for (var i = 0; i < missionsCache.length; i++) {
    var m = missionsCache[i];
    if (m.status !== "active" || !isMiningScanTitle(m.title)) continue;
    var rem = m.remaining || {};
    Object.keys(rem).forEach(function (k) {
      if (rem[k] > 0) needed[k] = (needed[k] || 0) + rem[k];
    });
  }
  var needKeys = Object.keys(needed).sort(function (a, b) {
    return needed[b] - needed[a] || a.localeCompare(b);
  });
  var all = (window.RESOURCES && window.RESOURCES.length) ? window.RESOURCES : FALLBACK_RESOURCES;
  var rest = all.filter(function (r) { return !needed[r]; });
  var html = "";
  if (needKeys.length) {
    html += "<optgroup label=\"Still needed\">" + needKeys.map(function (r) {
      return "<option value=\"" + r + "\">" + r + " (" + needed[r] + " left)</option>";
    }).join("") + "</optgroup>";
  }
  html += "<optgroup label=\"All resources\">" + (needKeys.length ? rest : all).map(function (r) {
    return "<option value=\"" + r + "\">" + r + "</option>";
  }).join("") + "</optgroup>";
  sel.innerHTML = html || all.map(function (r) { return "<option value=\"" + r + "\">" + r + "</option>"; }).join("");
  var opts = Array.prototype.slice.call(sel.options);
  if (prev && opts.some(function (o) { return o.value === prev; })) sel.value = prev;
  else if (needKeys.length) sel.value = needKeys[0];
}

async function pickLog() {
  if (window.electronAPI && window.electronAPI.pickLogFile) {
    var p = await window.electronAPI.pickLogFile();
    if (p) { toast("Log saved - watching: " + p); loadStats(); }
  } else toast("Log picker only available in Electron");
}

async function toggleOverlay() {
  if (!window.electronAPI || !window.electronAPI.overlayToggle) {
    toast("Overlay only available in the Electron app");
    return;
  }
  var vis = await window.electronAPI.overlayToggle();
  toast(vis ? "Overlay shown" : "Overlay hidden");
  var btn = document.getElementById("btn-overlay");
  if (btn) btn.textContent = vis ? "Overlay OK" : "Overlay";
}

async function onOverlayDragCheckbox(chk) {
  if (!window.electronAPI || !window.electronAPI.overlayClickThrough) return;
  await window.electronAPI.overlayClickThrough(!chk.checked);
  toast(chk.checked ? "Overlay drag ON" : "Overlay drag OFF");
}

async function autoOcrForMission(missionId, force) {
  if (force === undefined) force = false;
  if (!missionId) return;
  if (autoOcrBusy) {
    setTimeout(function () { autoOcrForMission(missionId, force); }, 2500);
    return;
  }
  if (!force && autoOcrAttempted.has(missionId)) return;
  autoOcrAttempted.add(missionId);
  var box = document.getElementById("ocr-result");
  var prog = document.getElementById("ocr-progress");
  if (!window.electronAPI || !window.electronAPI.captureScreen) {
    toast("Open the contract panel, then use From Clipboard or Upload");
    return;
  }
  autoOcrBusy = true;
  try {
    if (prog) {
      prog.style.display = "block";
      prog.textContent = force ? "Re-OCR: capturing screen..." : "Auto OCR: capturing screen...";
    }
    await pushStatus("Performing OCR - please leave the contract DETAILS open.", "ocr");
    if (!force) await new Promise(function (r) { setTimeout(r, 1500); });
    var maxW = 3840, maxH = 2160;
    try {
      if (window.screen && screen.width) {
        maxW = Math.max(1920, Math.min(3840, screen.width));
        maxH = Math.max(1080, Math.min(2160, screen.height));
      }
    } catch (_) {}
    var cap = await window.electronAPI.captureScreen({
      maxWidth: maxW, maxHeight: maxH,
      crop: { x: 0.22, y: 0.08, width: 0.72, height: 0.78 },
      _bust: Date.now(),
    });
    if (!cap || !cap.dataUrl) throw new Error("Screen capture returned no image");
    if (prog) prog.textContent = "Recognizing text...";
    var worker = await getTesseractWorker();
    var result = await worker.recognize(cap.dataUrl);
    var text = result.data.text;
    var r = await fetch("/api/ocr/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, mission_id: missionId, apply_progress: true }),
    });
    var data = await r.json();
    if (prog) prog.style.display = "none";
    var reqs = data.requirements || {};
    var keys = Object.keys(reqs);
    if (!keys.length) {
      autoOcrAttempted.delete(missionId);
      if (box) {
        box.textContent = "OCR found no requirements. Keep DETAILS open and retry Re-OCR.";
        box.style.color = "var(--orange)";
      }
      toast("OCR missed the panel - open DETAILS and press Re-OCR");
      return;
    }
    var summary = keys.map(function (k) { return k + "=" + reqs[k]; }).join(", ");
    if (box) box.innerHTML = "<strong class=\"ok-text\">OCR:</strong> " + summary;
    toast((force ? "Re-OCR: " : "Auto OCR: ") + summary);
    await pushStatus("OCR complete - you can close this contract or look for a new one.", "ocr_done");
    loadMissions();
  } catch (e) {
    if (prog) prog.style.display = "none";
    autoOcrAttempted.delete(missionId);
    toast("OCR failed: " + e);
  } finally {
    autoOcrBusy = false;
  }
}

window.isMiningScanTitle = isMiningScanTitle;
window.pickLog = pickLog;
window.toggleOverlay = toggleOverlay;
window.onOverlayDragCheckbox = onOverlayDragCheckbox;
window.setFilter = setFilter;
window.loadMissions = loadMissions;
window.loadStats = loadStats;
window.renderMissions = renderMissions;
window.recordScan = recordScan;
window.ocrClipboard = ocrClipboard;
window.ocrUpload = ocrUpload;
window.abandon = abandon;
window.autoOcrForMission = autoOcrForMission;
window.getTesseractWorker = getTesseractWorker;
window.pushStatus = pushStatus;
window.toast = toast;
window.loadActedLog = loadActedLog;
window.clearActedLog = clearActedLog;
window.addRequirementToMission = addRequirementToMission;
window.removeRequirementFromMission = removeRequirementFromMission;
window.createManualMission = createManualMission;

initResources().then(function () { loadMissions(); });
setInterval(loadMissions, 8000);
setInterval(loadActedLog, 4000);
