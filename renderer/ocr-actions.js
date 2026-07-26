/* Re-OCR = always re-capture screen, then OCR. New contract from screen. */

/** Capture settings that scale with display resolution (1080p / 1440p / 4K) */
function getCaptureOptions(fullFrame) {
  var maxW = 3840;
  var maxH = 2160;
  try {
    if (window.screen && screen.width) {
      maxW = Math.max(1920, Math.min(3840, screen.width));
      maxH = Math.max(1080, Math.min(2160, screen.height));
    }
  } catch (_) {}
  var opts = {
    maxWidth: maxW,
    maxHeight: maxH,
    _bust: Date.now(),
  };
  if (!fullFrame) {
    // Fractional crop of contract DETAILS (right-center) — resolution independent
    opts.crop = { x: 0.22, y: 0.08, width: 0.72, height: 0.78 };
  }
  return opts;
}

(function () {
  async function recaptureAndOcr(missionId, label) {
    const box = document.getElementById("ocr-result");
    const prog = document.getElementById("ocr-progress");
    const tag = label || "Re-OCR";

    if (!missionId) {
      if (typeof toast === "function") toast("No mission selected");
      return;
    }
    if (!window.electronAPI || !window.electronAPI.captureScreen) {
      if (typeof toast === "function")
        toast("Screen capture only works in the Electron app");
      return;
    }
    if (typeof autoOcrBusy !== "undefined" && autoOcrBusy) {
      if (typeof toast === "function") toast("OCR already running — wait a moment");
      return;
    }

    if (typeof autoOcrBusy !== "undefined") autoOcrBusy = true;
    if (typeof autoOcrAttempted !== "undefined") autoOcrAttempted.delete(missionId);

    try {
      if (prog) {
        prog.style.display = "block";
        prog.textContent = tag + ": capturing screen now…";
      }
      if (box) {
        box.textContent = tag + ": taking a fresh screenshot…";
        box.style.color = "var(--muted)";
      }
      if (typeof pushStatus === "function") {
        await pushStatus(
          "Capturing screen — leave the contract DETAILS panel open.",
          "ocr"
        );
      }
      if (typeof toast === "function") toast(tag + ": capturing screen…");

      let cap = await window.electronAPI.captureScreen(getCaptureOptions(false));
      if (!cap || !cap.dataUrl) {
        throw new Error("Screen capture returned no image");
      }

      if (prog) prog.textContent = tag + ": recognizing text…";
      if (typeof pushStatus === "function") {
        await pushStatus(
          "Performing OCR — please leave the contract screen open.",
          "ocr"
        );
      }

      const worker = await getTesseractWorker();
      let text = (await worker.recognize(cap.dataUrl)).data.text;

      let r = await fetch("/api/ocr/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          mission_id: missionId,
          apply_progress: true,
        }),
      });
      let data = await r.json();
      let reqs = data.requirements || {};
      let keys = Object.keys(reqs);

      if (!keys.length) {
        if (prog) prog.textContent = tag + ": retrying full screen…";
        cap = await window.electronAPI.captureScreen(getCaptureOptions(true));
        if (cap && cap.dataUrl) {
          text = (await worker.recognize(cap.dataUrl)).data.text;
          r = await fetch("/api/ocr/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              mission_id: missionId,
              apply_progress: true,
            }),
          });
          data = await r.json();
          reqs = data.requirements || {};
          keys = Object.keys(reqs);
        }
      }

      if (prog) prog.style.display = "none";

      if (!keys.length) {
        if (box) {
          box.textContent =
            tag + " found no requirements. Keep DETAILS open and try again.";
          box.style.color = "var(--orange)";
        }
        if (typeof pushStatus === "function") {
          await pushStatus(
            "OCR found no data — leave DETAILS open and retry.",
            "error"
          );
        }
        if (typeof toast === "function") toast(tag + " missed the panel");
        return;
      }

      const summary = keys.map((k) => k + "=" + reqs[k]).join(", ");
      if (box) {
        box.innerHTML =
          '<strong style="color:var(--green)">' +
          tag +
          ":</strong> " +
          summary +
          (data.applied ? " → applied" : "");
        box.style.color = "var(--muted)";
      }
      if (typeof toast === "function") toast(tag + ": " + summary);
      if (typeof pushStatus === "function") {
        await pushStatus(
          "OCR complete — you can close this contract or look for a new one.",
          "ocr_done"
        );
      }
      if (typeof autoOcrAttempted !== "undefined")
        autoOcrAttempted.add(missionId);
      if (typeof loadMissions === "function") loadMissions();
    } catch (e) {
      if (prog) prog.style.display = "none";
      if (box) {
        box.textContent = tag + " error: " + e;
        box.style.color = "var(--red)";
      }
      if (typeof pushStatus === "function")
        await pushStatus("OCR failed — try again.", "error");
      if (typeof toast === "function") toast(tag + " failed: " + e);
    } finally {
      if (typeof autoOcrBusy !== "undefined") autoOcrBusy = false;
    }
  }

  window.ocrThisMission = function (mid) {
    const sel = document.getElementById("ocr-mission");
    if (sel) {
      if (![...sel.options].some((o) => o.value === mid)) {
        const m = (
          typeof missionsCache !== "undefined" ? missionsCache : []
        ).find((x) => x.mission_id === mid);
        const label = m
          ? (m.title || "").slice(0, 40) + " (" + mid.slice(0, 8) + ")"
          : mid.slice(0, 8);
        const opt = document.createElement("option");
        opt.value = mid;
        opt.textContent = label;
        sel.appendChild(opt);
      }
      sel.value = mid;
    }
    const card = document.getElementById("ocr-card");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    recaptureAndOcr(mid, "Re-OCR");
  };

  window.newContractFromScreen = async function () {
    const box = document.getElementById("ocr-result");
    const prog = document.getElementById("ocr-progress");
    if (!window.electronAPI || !window.electronAPI.captureScreen) {
      if (typeof toast === "function") toast("Screen OCR needs the Electron app");
      return;
    }
    if (typeof autoOcrBusy !== "undefined" && autoOcrBusy) {
      if (typeof toast === "function") toast("OCR already running — wait a moment");
      return;
    }
    if (typeof autoOcrBusy !== "undefined") autoOcrBusy = true;
    try {
      if (prog) {
        prog.style.display = "block";
        prog.textContent = "New contract: capturing screen…";
      }
      if (box) {
        box.textContent = "Creating mission from fresh screen capture…";
        box.style.color = "var(--muted)";
      }
      if (typeof pushStatus === "function")
        await pushStatus(
          "Capturing screen — leave the contract DETAILS panel open.",
          "ocr"
        );

      let cap = await window.electronAPI.captureScreen(getCaptureOptions(false));
      if (!cap || !cap.dataUrl) throw new Error("Screen capture returned no image");
      if (prog) prog.textContent = "New contract: recognizing text…";
      const worker = await getTesseractWorker();
      let text = (await worker.recognize(cap.dataUrl)).data.text;
      let parseRes = await fetch("/api/ocr/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      let parsed = await parseRes.json();
      let reqs = parsed.requirements || {};
      let progress = parsed.progress || {};
      let keys = Object.keys(reqs);

      if (!keys.length) {
        if (prog) prog.textContent = "Retrying full-screen capture…";
        cap = await window.electronAPI.captureScreen(getCaptureOptions(true));
        if (cap && cap.dataUrl) {
          text = (await worker.recognize(cap.dataUrl)).data.text;
          parseRes = await fetch("/api/ocr/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          parsed = await parseRes.json();
          reqs = parsed.requirements || {};
          progress = parsed.progress || {};
          keys = Object.keys(reqs);
        }
      }

      if (!keys.length) {
        if (prog) prog.style.display = "none";
        if (box) {
          box.textContent =
            "No requirements found. Open contract DETAILS and try again.";
          box.style.color = "var(--orange)";
        }
        if (typeof toast === "function") toast("No contract data found on screen");
        return;
      }

      const titleBits = keys.map((k) => reqs[k] + "× " + k).join(", ");
      const createRes = await fetch("/api/missions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Ore Scan (screen): " + titleBits,
          requirements: reqs,
          progress,
        }),
      });
      const mission = await createRes.json();
      if (mission.error) throw new Error(mission.error);
      if (typeof seenMissionIds !== "undefined")
        seenMissionIds.add(mission.mission_id);
      if (typeof autoOcrAttempted !== "undefined")
        autoOcrAttempted.add(mission.mission_id);
      if (prog) prog.style.display = "none";
      const summary = keys.map((k) => k + "=" + reqs[k]).join(", ");
      if (box) {
        box.innerHTML =
          '<strong style="color:var(--green)">New mission:</strong> ' + summary;
        box.style.color = "var(--muted)";
      }
      if (typeof toast === "function") toast("Created mission: " + summary);
      if (typeof pushStatus === "function")
        await pushStatus(
          "OCR complete — you can close this contract or look for a new one.",
          "ocr_done"
        );
      if (typeof loadMissions === "function") loadMissions();
    } catch (e) {
      if (prog) prog.style.display = "none";
      if (box) {
        box.textContent = "New contract OCR error: " + e;
        box.style.color = "var(--red)";
      }
      if (typeof toast === "function") toast("New contract OCR failed: " + e);
    } finally {
      if (typeof autoOcrBusy !== "undefined") autoOcrBusy = false;
    }
  };

  window.recaptureAndOcr = recaptureAndOcr;
  window.getCaptureOptions = getCaptureOptions;
})();
