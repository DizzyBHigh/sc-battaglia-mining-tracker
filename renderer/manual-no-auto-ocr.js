/* Manual mission cards must not auto-OCR. Only the Re-OCR button runs OCR. */
(function () {
  var skip = (window.skipAutoOcr = window.skipAutoOcr || new Set());

  function wrapCreateManual() {
    var orig = window.createManualMission;
    if (typeof orig !== "function" || orig.__noAutoOcrWrapped) return;
    window.createManualMission = async function () {
      var before = new Set(
        (window.missionsCache || []).map(function (m) {
          return m.mission_id;
        })
      );
      var result = await orig.apply(this, arguments);
      try {
        var after = window.missionsCache || [];
        for (var i = 0; i < after.length; i++) {
          var id = after[i].mission_id;
          if (!before.has(id)) skip.add(id);
        }
        for (var j = 0; j < after.length; j++) {
          if (/^\s*manual\b/i.test(after[j].title || "")) skip.add(after[j].mission_id);
        }
      } catch (_) {}
      return result;
    };
    window.createManualMission.__noAutoOcrWrapped = true;
  }

  function wrapAutoOcr() {
    var orig = window.autoOcrForMission;
    if (typeof orig !== "function" || orig.__noAutoOcrWrapped) return;
    window.autoOcrForMission = async function (missionId, force) {
      if (!force && missionId && skip.has(missionId)) {
        return;
      }
      if (!force && missionId) {
        try {
          var list = window.missionsCache || [];
          for (var i = 0; i < list.length; i++) {
            if (list[i].mission_id === missionId && /^\s*manual\b/i.test(list[i].title || "")) {
              skip.add(missionId);
              return;
            }
          }
        } catch (_) {}
      }
      return orig.apply(this, arguments);
    };
    window.autoOcrForMission.__noAutoOcrWrapped = true;
  }

  function apply() {
    wrapCreateManual();
    wrapAutoOcr();
  }

  apply();
  setTimeout(apply, 0);
  setTimeout(apply, 500);
  setTimeout(apply, 2000);
})();
