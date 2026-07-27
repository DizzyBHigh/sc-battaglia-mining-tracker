/**
 * Mission list filters and clear-completed helper.
 * Loaded after app.js.
 */
(function () {
  var filterResource = "";
  var filterFrom = "";
  var filterTo = "";

  function parseLocalDateStart(s) {
    if (!s) return null;
    var d = new Date(s + "T00:00:00");
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function parseLocalDateEnd(s) {
    if (!s) return null;
    var d = new Date(s + "T23:59:59.999");
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function missionMatchesFilters(m) {
    if (filterResource) {
      var reqs = m.requirements || {};
      if (!Object.prototype.hasOwnProperty.call(reqs, filterResource)) return false;
    }
    var fromTs = parseLocalDateStart(filterFrom);
    var toTs = parseLocalDateEnd(filterTo);
    if (fromTs != null || toTs != null) {
      var t = Date.parse(m.accepted_at || m.completed_at || "");
      if (isNaN(t)) return false;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
    }
    return true;
  }

  function populateFilterResourceSelect() {
    var sel = document.getElementById("filter-resource");
    if (!sel) return;
    var prev = sel.value;
    var all = (window.RESOURCES && window.RESOURCES.length)
      ? window.RESOURCES
      : (typeof FALLBACK_RESOURCES !== "undefined" ? FALLBACK_RESOURCES : []);
    sel.innerHTML =
      '<option value="">All resources</option>' +
      all.map(function (r) {
        return '<option value="' + r + '">' + r + "</option>";
      }).join("");
    if (prev) sel.value = prev;
  }

  function applyMissionFilters() {
    var resEl = document.getElementById("filter-resource");
    var fromEl = document.getElementById("filter-from");
    var toEl = document.getElementById("filter-to");
    filterResource = resEl ? resEl.value : "";
    filterFrom = fromEl ? fromEl.value : "";
    filterTo = toEl ? toEl.value : "";
    if (typeof renderMissions === "function") renderMissions();
  }

  function clearMissionFilters() {
    filterResource = "";
    filterFrom = "";
    filterTo = "";
    var resEl = document.getElementById("filter-resource");
    var fromEl = document.getElementById("filter-from");
    var toEl = document.getElementById("filter-to");
    if (resEl) resEl.value = "";
    if (fromEl) fromEl.value = "";
    if (toEl) toEl.value = "";
    if (typeof renderMissions === "function") renderMissions();
  }

  var _origRender = null;
  function installRenderWrapper() {
    if (typeof window.renderMissions !== "function") return;
    if (window.renderMissions.__wrappedFilters) return;
    _origRender = window.renderMissions;
    window.renderMissions = function () {
      var cache = typeof missionsCache !== "undefined" ? missionsCache : [];
      var saved = cache.slice();
      var filtered = cache.filter(function (m) {
        if (typeof isMiningScanTitle === "function") {
          if (!isMiningScanTitle(m.title) && !(m.requirements && Object.keys(m.requirements).length))
            return false;
        }
        return missionMatchesFilters(m);
      });
      if (typeof missionsCache !== "undefined") {
        missionsCache.length = 0;
        for (var i = 0; i < filtered.length; i++) missionsCache.push(filtered[i]);
      }
      try {
        _origRender();
      } finally {
        if (typeof missionsCache !== "undefined") {
          missionsCache.length = 0;
          for (var j = 0; j < saved.length; j++) missionsCache.push(saved[j]);
        }
      }
    };
    window.renderMissions.__wrappedFilters = true;
  }

  async function deleteMission(mid) {
    if (!mid) return;
    var ok = await showConfirm("Permanently remove this mission from the tracker?", {
      title: "Delete mission",
      okText: "Delete",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    var r = await fetch("/api/mission/" + mid, { method: "DELETE" });
    var data = await r.json();
    if (data.error) {
      if (typeof toast === "function") toast("Error: " + data.error);
      return;
    }
    if (typeof toast === "function") toast("Mission removed");
    if (typeof loadMissions === "function") loadMissions();
  }

  async function clearCompletedMissions() {
    var ok = await showConfirm("Remove all completed missions from the tracker? This cannot be undone.", {
      title: "Clear completed",
      okText: "Clear all",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    var r = await fetch("/api/missions/clear-completed", { method: "POST" });
    var data = await r.json();
    if (data.error) {
      if (typeof toast === "function") toast("Error: " + data.error);
      return;
    }
    if (typeof toast === "function") toast("Removed " + (data.removed || 0) + " completed mission(s)");
    if (typeof loadMissions === "function") loadMissions();
  }

  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest("[data-act=delete]") : null;
    if (!btn) return;
    var mid = btn.getAttribute("data-mid");
    if (mid) deleteMission(mid);
  });

  var _origSetFilter = null;
  function installSetFilterWrapper() {
    if (typeof window.setFilter !== "function") return;
    if (window.setFilter.__wrapped) return;
    _origSetFilter = window.setFilter;
    window.setFilter = function (btn) {
      if (btn && btn.dataset) window._missionFilter = btn.dataset.filter;
      _origSetFilter(btn);
    };
    window.setFilter.__wrapped = true;
  }

  var _origLoadStats = null;
  function installStatsHook() {
    if (typeof window.loadStats !== "function") return;
    if (window.loadStats.__wrappedFilters) return;
    _origLoadStats = window.loadStats;
    window.loadStats = async function () {
      await _origLoadStats();
      populateFilterResourceSelect();
    };
    window.loadStats.__wrappedFilters = true;
  }

  function boot() {
    installRenderWrapper();
    installSetFilterWrapper();
    installStatsHook();
    populateFilterResourceSelect();

    var resEl = document.getElementById("filter-resource");
    var fromEl = document.getElementById("filter-from");
    var toEl = document.getElementById("filter-to");
    if (resEl) resEl.addEventListener("change", applyMissionFilters);
    if (fromEl) fromEl.addEventListener("change", applyMissionFilters);
    if (toEl) toEl.addEventListener("change", applyMissionFilters);
  }

  window.applyMissionFilters = applyMissionFilters;
  window.clearMissionFilters = clearMissionFilters;
  window.clearCompletedMissions = clearCompletedMissions;
  window.deleteMission = deleteMission;
  window.populateFilterResourceSelect = populateFilterResourceSelect;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 50);
  }
})();
