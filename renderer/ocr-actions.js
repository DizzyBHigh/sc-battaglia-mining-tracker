/* OCR actions: force Re-OCR + new contract from screen */
(function () {
  const _wait = setInterval(() => {
    if (typeof autoOcrForMission !== "function") return;
    clearInterval(_wait);
    const orig = autoOcrForMission;
    window.autoOcrForMission = async function (missionId, force = false) {
      if (force && typeof autoOcrAttempted !== "undefined") {
        autoOcrAttempted.delete(missionId);
      }
      // Prefer force-aware original if it accepts 2 args
      return orig(missionId, force);
    };
  }, 50);

  window.ocrThisMission = function (mid) {
    const sel = document.getElementById("ocr-mission");
    if (sel) {
      if (![...sel.options].some((o) => o.value === mid)) {
        const m = (typeof missionsCache !== "undefined" ? missionsCache : []).find(
          (x) => x.mission_id === mid
        );
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
    if (typeof toast === "function")
      toast("Re-OCR: capturing screen… leave the contract panel open");
    if (typeof autoOcrForMission === "function") autoOcrForMission(mid, true);
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
        box.textContent = "Creating mission from screen OCR…";
        box.style.color = "var(--muted)";
      }
      if (typeof pushStatus === "function")
        await pushStatus(
          "Performing OCR — please leave the contract screen open.",
          "ocr"
        );
      const cap = await window.electronAPI.captureScreen({
        maxWidth: 1600,
        maxHeight: 900,
        crop: { x: 0.28, y: 0.1, width: 0.7, height: 0.75 },
      });
      if (prog) prog.textContent = "New contract: recognizing text…";
      const worker = await getTesseractWorker();
      const {
        data: { text },
      } = await worker.recognize(cap.dataUrl);
      const parseRes = await fetch("/api/ocr/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const parsed = await parseRes.json();
      const reqs = parsed.requirements || {};
      const progress = parsed.progress || {};
      const keys = Object.keys(reqs);
      if (!keys.length) {
        if (prog) prog.style.display = "none";
        if (box) {
          box.textContent =
            "No requirements found on screen. Open contract DETAILS and try again.";
          box.style.color = "var(--orange)";
        }
        if (typeof pushStatus === "function")
          await pushStatus(
            "OCR found no data — leave DETAILS open and retry.",
            "error"
          );
        if (typeof toast === "function") toast("No contract data found on screen");
        return;
      }
      const titleBits = keys.map((k) => reqs[k] + "× " + k).join(", ");
      const title = "Screen OCR: " + titleBits;
      const createRes = await fetch("/api/missions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, requirements: reqs, progress }),
      });
      const mission = await createRes.json();
      if (mission.error) throw new Error(mission.error);
      if (typeof seenMissionIds !== "undefined") seenMissionIds.add(mission.mission_id);
      if (typeof autoOcrAttempted !== "undefined")
        autoOcrAttempted.add(mission.mission_id);
      if (prog) prog.style.display = "none";
      const summary = keys.map((k) => k + "=" + reqs[k]).join(", ");
      if (box) {
        box.innerHTML =
          '<strong style="color:var(--green)">New mission:</strong> ' + summary;
        box.style.color = "var(--muted)";
      }
      if (typeof pushStatus === "function")
        await pushStatus(
          "OCR complete — you can close this contract or look for a new one.",
          "ocr_done"
        );
      if (typeof toast === "function") toast("Created mission: " + summary);
      if (typeof loadMissions === "function") loadMissions();
    } catch (e) {
      if (prog) prog.style.display = "none";
      if (box) {
        box.textContent = "New contract OCR error: " + e;
        box.style.color = "var(--red)";
      }
      if (typeof pushStatus === "function")
        await pushStatus("OCR failed — try again.", "error");
      if (typeof toast === "function") toast("New contract OCR failed: " + e);
    } finally {
      if (typeof autoOcrBusy !== "undefined") autoOcrBusy = false;
    }
  };
})();
