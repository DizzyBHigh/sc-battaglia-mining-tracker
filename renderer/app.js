var currentFilter = "active";
var missionsCache = [];
var seenMissionIds = new Set();
var toastTimer = null;
var autoOcrBusy = false;
var autoOcrAttempted = new Set();
var tesseractWorker = null;

async function pushStatus(message, phase) {
  try {
    await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, phase: phase || "idle" }),
    });
  } catch (_) {}
}

function toast(msg) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4500);
}

function setFilter(btn) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  renderMissions();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "&#39;");
}

function fmtTime(iso) {
  if (!iso) return "–";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return String(iso).slice(0, 16);
  }
}

function sigLabel(resource) {
  const sig = (window.SIGNATURES || {})[resource];
  return sig != null
    ? ' <span style="color:var(--accent);font-size:0.8em;font-weight:600">RS ' + sig + "</span>"
    : "";
}

async function loadStats() {
  const r = await fetch("/api/stats");
  const s = await r.json();
  document.getElementById("stat-active").textContent = s.active_count;
  document.getElementById("stat-completed").textContent = s.completed_count;
  document.getElementById("stat-scans").textContent = s.scan_events;
  const logEl = document.getElementById("log-path-text");
  if (logEl) {
    const lp = s.log_path || "";
    logEl.textContent = lp || "(not set — click Log file…)";
    logEl.title = lp || "No Game.log selected";
  }
  const box = document.getElementById("remaining-totals");
  const rem = s.remaining_totals || {};
  const keys = Object.keys(rem).sort();
  if (!keys.length) {
    box.innerHTML = '<div class="empty">No active requirements</div>';
  } else {
    box.innerHTML = keys
      .map(function (k) {
        return '<div class="req-item"><span>' + k + "</span><strong>" + rem[k] + "</strong></div>";
      })
      .join("");
  }
}

async function loadMissions() {
  const r = await fetch("/api/missions");
  missionsCache = await r.json();
  for (const m of missionsCache) {
    if (m.status === "active" && !seenMissionIds.has(m.mission_id)) {
      seenMissionIds.add(m.mission_id);
      if (!Object.keys(m.requirements || {}).length) {
        populateOcrMissionSelect();
        autoOcrForMission(m.mission_id);
      }
    }
  }
  renderMissions();
  populateOcrMissionSelect();
  loadStats();
  loadHistory();
  checkRecentCompletes();
}

function renderMissions() {
  const list = document.getElementById("mission-list");
  let items = missionsCache;
  if (currentFilter === "active") items = items.filter((m) => m.status === "active");
  if (currentFilter === "completed") items = items.filter((m) => m.status === "completed");
  if (!items.length) {
    list.innerHTML = '<div class="empty">No missions match this filter</div>';
    return;
  }
  list.innerHTML = items
    .map(function (m) {
      const reqs = m.requirements || {};
      const prog = m.progress || {};
      const keys = Object.keys(reqs).sort();
      const needsReq = keys.length === 0 && m.status === "active";
      const cls = m.status === "completed" ? "complete" : needsReq ? "needs-req" : "";
      let body = "";
      if (keys.length) {
        body =
          '<div class="req-grid">' +
          keys
            .map(function (r) {
              const need = reqs[r] || 0;
              const have = prog[r] || 0;
              const done = need > 0 && have >= need;
              const left = Math.max(0, need - have);
              return (
                '<div class="req-item ' +
                (done ? "done" : "") +
                '">' +
                '<span class="req-name">' +
                escapeHtml(r) +
                sigLabel(r) +
                "</span>" +
                '<span class="req-counts"><strong>' +
                have +
                '</strong><span style="color:var(--muted)"> / ' +
                need +
                "</span>" +
                (!done && m.status === "active"
                  ? '<span class="req-left">' + left + " left</span>"
                  : "") +
                (done ? '<span class="req-left" style="color:var(--green)">done</span>' : "") +
                "</span></div>"
              );
            })
            .join("") +
          "</div>";
      } else if (m.status === "active") {
        body =
          '<div class="empty" style="padding:0.6rem 0">No items to scan yet — open DETAILS and press <strong>Re-OCR</strong>.</div>';
      } else {
        body = '<div class="empty" style="padding:0.5rem">No requirements recorded</div>';
      }
      const actions =
        m.status === "active"
          ? '<div style="margin-top:0.55rem;display:flex;gap:0.4rem;flex-wrap:wrap">' +
            '<button class="btn btn-orange btn-sm" onclick="ocrThisMission(\'' +
            m.mission_id +
            "')\">Re-OCR</button>" +
            '<button class="btn btn-ghost btn-sm" onclick="abandon(\'' +
            m.mission_id +
            "')\">Abandon</button></div>"
          : "";
      return (
        '<div class="mission ' +
        cls +
        '"><div class="mission-header"><div>' +
        '<div class="mission-title">' +
        escapeHtml(m.title) +
        "</div>" +
        '<div class="mission-meta">' +
        m.mission_id.slice(0, 8) +
        "… · accepted " +
        fmtTime(m.accepted_at) +
        (m.completed_at ? " · done " + fmtTime(m.completed_at) : "") +
        "</div></div>" +
        '<span style="font-size:0.75rem;color:' +
        (m.status === "completed" ? "var(--green)" : "var(--orange)") +
        '">' +
        m.status +
        "</span></div>" +
        body +
        actions +
        "</div>"
      );
    })
    .join("");
  refreshScanDropdown();
}

async function abandon(mid) {
  if (!confirm("Mark this mission as abandoned?")) return;
  await fetch("/api/mission/" + mid, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "abandoned" }),
  });
  loadMissions();
}

async function recordScan() {
  const resource = document.getElementById("scan-resource").value;
  const count = parseInt(document.getElementById("scan-count").value, 10) || 1;
  const r = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource, count }),
  });
  const data = await r.json();
  if (data.error) {
    toast("Error: " + data.error);
    return;
  }
  const appliedN = Object.keys(data.applied || {}).length;
  let msg = "Scanned " + count + "× " + resource + " → applied to " + appliedN + " mission(s)";
  if (data.newly_completed && data.newly_completed.length)
    msg += " · " + data.newly_completed.length + " completed!";
  toast(msg);
  document.getElementById("complete-banner").style.display = "none";
  loadMissions();
}

function populateOcrMissionSelect() {
  const sel = document.getElementById("ocr-mission");
  if (!sel) return;
  const active = missionsCache.filter((m) => m.status === "active");
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">— most recent active —</option>' +
    active
      .map(function (m) {
        return (
          '<option value="' +
          m.mission_id +
          '">' +
          escapeHtml(m.title).slice(0, 40) +
          " (" +
          m.mission_id.slice(0, 8) +
          ")</option>"
        );
      })
      .join("");
  if (cur) sel.value = cur;
}

function selectedOcrMissionId() {
  const mid = document.getElementById("ocr-mission").value;
  if (mid) return mid;
  const active = missionsCache.filter((m) => m.status === "active");
  return active.length ? active[0].mission_id : "";
}

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  const prog = document.getElementById("ocr-progress");
  if (prog) {
    prog.style.display = "block";
    prog.textContent = "Downloading Tesseract.js model (first time only)…";
  }
  tesseractWorker = await Tesseract.createWorker("eng", 1, {
    logger: function (m) {
      if (m.status === "recognizing text" && prog) {
        const pct = m.progress != null ? Math.round(m.progress * 100) : 0;
        prog.textContent = "Recognizing text… " + pct + "%";
      }
    },
  });
  await tesseractWorker.setParameters({ tessedit_pageseg_mode: "4" });
  return tesseractWorker;
}

async function ocrImageSource(source) {
  const box = document.getElementById("ocr-result");
  const prog = document.getElementById("ocr-progress");
  if (box) box.textContent = "";
  if (prog) {
    prog.style.display = "block";
    prog.textContent = "Starting OCR…";
  }
  await pushStatus("Performing OCR — please leave the contract screen open.", "ocr");
  try {
    const worker = await getTesseractWorker();
    if (prog) prog.textContent = "Recognizing text…";
    const result = await worker.recognize(source);
    const text = result.data.text;
    if (prog) prog.style.display = "none";
    const mid = selectedOcrMissionId();
    const r = await fetch("/api/ocr/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, mission_id: mid || null, apply_progress: true }),
    });
    const data = await r.json();
    if (data.error) {
      if (box) {
        box.textContent = "Error: " + data.error;
        box.style.color = "var(--red)";
      }
      return;
    }
    const reqs = data.requirements || {};
    const keys = Object.keys(reqs);
    if (!keys.length) {
      if (box) {
        box.textContent = "No requirements detected.";
        box.style.color = "var(--orange)";
      }
      return;
    }
    const summary = keys.map(function (k) { return k + "=" + reqs[k]; }).join(", ");
    if (box) {
      box.innerHTML = '<strong style="color:var(--green)">Found:</strong> ' + summary;
    }
    toast("OCR: " + summary);
    await pushStatus("OCR complete — you can close this contract or look for a new one.", "ocr_done");
    loadMissions();
  } catch (e) {
    if (prog) prog.style.display = "none";
    if (box) {
      box.textContent = "OCR error: " + e;
      box.style.color = "var(--red)";
    }
    toast("OCR failed: " + e);
  }
}

async function ocrClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(function (t) { return t.startsWith("image/"); });
      if (type) {
        await ocrImageSource(await item.getType(type));
        return;
      }
    }
    toast("Clipboard has no image.");
  } catch (e) {
    toast("Clipboard blocked – press Ctrl+V after copying a screenshot.");
  }
}

async function ocrUpload(input) {
  if (!input.files || !input.files[0]) return;
  await ocrImageSource(input.files[0]);
  input.value = "";
}

document.addEventListener("paste", async function (ev) {
  const items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      ev.preventDefault();
      const file = item.getAsFile();
      if (file) await ocrImageSource(file);
      return;
    }
  }
});

async function loadHistory() {
  const r = await fetch("/api/history");
  const hist = await r.json();
  const box = document.getElementById("history-list");
  if (!hist.length) {
    box.innerHTML = '<div class="empty">No scans yet</div>';
    return;
  }
  box.innerHTML = hist
    .slice()
    .reverse()
    .slice(0, 15)
    .map(function (e) {
      return (
        '<div class="history-item"><strong>' +
        e.count +
        "× " +
        e.resource +
        "</strong> → " +
        e.applied_to.length +
        ' mission(s)<br/><span style="font-size:0.7rem">' +
        fmtTime(e.timestamp) +
        "</span></div>"
      );
    })
    .join("");
}

async function checkRecentCompletes() {
  const r = await fetch("/api/recent_completes");
  const list = await r.json();
  if (!list.length) return;
  const latest = list[list.length - 1];
  const age = Date.now() - new Date(latest.timestamp).getTime();
  if (age < 120000) {
    document.getElementById("complete-banner").style.display = "block";
    document.getElementById("complete-msg").textContent =
      " " +
      list.filter(function (x) {
        return Date.now() - new Date(x.timestamp).getTime() < 120000;
      }).length +
      " objective(s) finished around " +
      fmtTime(latest.timestamp) +
      ".";
  }
}

async function initResources() {
  try {
    window.RESOURCES = await (await fetch("/api/resources")).json();
    try {
      window.SIGNATURES = await (await fetch("/api/signatures")).json();
    } catch (_) {
      window.SIGNATURES = {};
    }
    refreshScanDropdown();
  } catch (e) {
    console.error(e);
  }
}

function refreshScanDropdown() {
  const sel = document.getElementById("scan-resource");
  if (!sel) return;
  const prev = sel.value;
  const needed = {};
  for (const m of missionsCache) {
    if (m.status !== "active") continue;
    for (const [k, v] of Object.entries(m.remaining || {})) {
      if (v > 0) needed[k] = (needed[k] || 0) + v;
    }
  }
  const needKeys = Object.keys(needed).sort(function (a, b) {
    return needed[b] - needed[a] || a.localeCompare(b);
  });
  const all = window.RESOURCES || [];
  const rest = all.filter(function (r) { return !needed[r]; });
  let html = "";
  if (needKeys.length) {
    html +=
      '<optgroup label="Still needed">' +
      needKeys
        .map(function (r) {
          return '<option value="' + r + '">' + r + " (" + needed[r] + " left)</option>";
        })
        .join("") +
      "</optgroup>";
  }
  html +=
    '<optgroup label="All resources">' +
    (needKeys.length ? rest : all)
      .map(function (r) {
        return '<option value="' + r + '">' + r + "</option>";
      })
      .join("") +
    "</optgroup>";
  sel.innerHTML =
    html ||
    all
      .map(function (r) {
        return '<option value="' + r + '">' + r + "</option>";
      })
      .join("");
  if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) {
    sel.value = prev;
  } else if (needKeys.length) {
    sel.value = needKeys[0];
  }
}

async function pickLog() {
  if (window.electronAPI && window.electronAPI.pickLogFile) {
    const p = await window.electronAPI.pickLogFile();
    if (p) {
      toast("Log saved — watching: " + p);
      loadStats();
    }
  } else {
    toast("Log picker only available in Electron");
  }
}

async function toggleOverlay() {
  if (!window.electronAPI || !window.electronAPI.overlayToggle) {
    toast("Overlay only available in the Electron app");
    return;
  }
  const vis = await window.electronAPI.overlayToggle();
  toast(vis ? "Overlay shown" : "Overlay hidden");
  const btn = document.getElementById("btn-overlay");
  if (btn) btn.textContent = vis ? "Overlay ✓" : "Overlay";
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
  const box = document.getElementById("ocr-result");
  const prog = document.getElementById("ocr-progress");
  if (!window.electronAPI || !window.electronAPI.captureScreen) {
    toast("Open the contract panel, then use From Clipboard or Upload");
    return;
  }
  autoOcrBusy = true;
  try {
    if (prog) {
      prog.style.display = "block";
      prog.textContent = force ? "Re-OCR: capturing screen…" : "Auto OCR: capturing screen…";
    }
    await pushStatus("Performing OCR — please leave the contract screen open.", "ocr");
    if (!force) await new Promise(function (r) { setTimeout(r, 800); });
    const cap = await window.electronAPI.captureScreen({
      maxWidth: 1920,
      maxHeight: 1080,
      crop: { x: 0.28, y: 0.1, width: 0.7, height: 0.75 },
      _bust: Date.now(),
    });
    if (!cap || !cap.dataUrl) throw new Error("Screen capture returned no image");
    if (prog) prog.textContent = "Recognizing text…";
    const worker = await getTesseractWorker();
    const result = await worker.recognize(cap.dataUrl);
    const text = result.data.text;
    const r = await fetch("/api/ocr/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, mission_id: missionId, apply_progress: true }),
    });
    const data = await r.json();
    if (prog) prog.style.display = "none";
    const reqs = data.requirements || {};
    const keys = Object.keys(reqs);
    if (!keys.length) {
      autoOcrAttempted.delete(missionId);
      if (box) {
        box.textContent = "OCR found no requirements. Keep DETAILS open and retry.";
        box.style.color = "var(--orange)";
      }
      toast("OCR missed the panel — try again");
      return;
    }
    const summary = keys.map(function (k) { return k + "=" + reqs[k]; }).join(", ");
    if (box) box.innerHTML = '<strong style="color:var(--green)">OCR:</strong> ' + summary;
    toast((force ? "Re-OCR: " : "Auto OCR: ") + summary);
    await pushStatus("OCR complete — you can close this contract or look for a new one.", "ocr_done");
    loadMissions();
  } catch (e) {
    if (prog) prog.style.display = "none";
    autoOcrAttempted.delete(missionId);
    toast("OCR failed: " + e);
  } finally {
    autoOcrBusy = false;
  }
}

window.pickLog = pickLog;
window.toggleOverlay = toggleOverlay;
window.onOverlayDragCheckbox = onOverlayDragCheckbox;
window.setFilter = setFilter;
window.loadMissions = loadMissions;
window.recordScan = recordScan;
window.ocrClipboard = ocrClipboard;
window.ocrUpload = ocrUpload;
window.abandon = abandon;
window.autoOcrForMission = autoOcrForMission;
window.getTesseractWorker = getTesseractWorker;
window.pushStatus = pushStatus;
window.toast = toast;

initResources().then(function () {
  loadMissions();
});
setInterval(loadMissions, 8000);
