/**
 * Mission list filters, delete completed, scan stats panel.
 * Loaded after app.js — augments / overrides as needed.
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

  // Wrap renderMissions to apply extra filters
  var _origRender = null;
  function installRenderWrapper() {
    if (typeof window.renderMissions !== "function") return;
    if (window.renderMissions.__wrappedFilters) return;
    _origRender = window.renderMissions;
    window.renderMissions = function () {
      // Temporarily filter missionsCache view via monkey-patch of list building:
      // call original but it reads missionsCache — so we filter by temporarily
      // swapping is not ideal. Instead re-implement filter on top:
      var list = document.getElementById("mission-list");
      if (!list) return _origRender();

      var cache = typeof missionsCache !== "undefined" ? missionsCache : [];
      var currentFilter = typeof window.currentFilter === "string"
        ? window.currentFilter
        : (document.querySelector(".tab.active") || {}).dataset
          ? document.querySelector(".tab.active").dataset.filter
          : "active";

      // Prefer module-level currentFilter from app.js if exposed
      try {
        if (typeof currentFilter === "undefined" && window._missionFilter) {
          currentFilter = window._missionFilter;
        }
      } catch (_) {}

      // Use app's render if we can inject filter via temp cache
      var saved = cache.slice();
      var filtered = cache.filter(function (m) {
        if (typeof isMiningScanTitle === "function") {
          if (!isMiningScanTitle(m.title) && !(m.requirements && Object.keys(m.requirements).length))
            return false;
        }
        return missionMatchesFilters(m);
      });
      // Mutate missionsCache in place for original render
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

  async function renderScanStatsPanel(s) {
    var box = document.getElementById("scan-stats-panel");
    if (!box) return;
    var stats = (s && s.scan_stats) || {};
    var totalEvents = stats.total_events != null ? stats.total_events : (s && s.scan_events) || 0;
    var totalUnits = stats.total_units != null ? stats.total_units : 0;
    var by = stats.by_resource || {};
    var keys = Object.keys(by).sort(function (a, b) {
      return (by[b].units || 0) - (by[a].units || 0) || a.localeCompare(b);
    });
    var head =
      '<div class="stat-row"><span>Total scan events</span><strong>' +
      totalEvents +
      "</strong></div>" +
      '<div class="stat-row"><span>Total units recorded</span><strong>' +
      totalUnits +
      "</strong></div>";
    if (!keys.length) {
      box.innerHTML = head + '<div class="empty" style="padding:0.6rem 0">No scans recorded yet</div>';
      return;
    }
    box.innerHTML =
      head +
      '<div class="stat-sub">Per resource</div>' +
      keys
        .map(function (k) {
          var row = by[k];
          return (
            '<div class="stat-row"><span>' +
            k +
            '</span><strong>' +
            (row.units || 0) +
            '</strong> <span class="stat-meta">(' +
            (row.events || 0) +
            " events)</span></div>"
          );
        })
        .join("");
  }

  // Hook loadStats to fill scan stats panel
  var _origLoadStats = null;
  function installStatsWrapper() {
    if (typeof window.loadStats !== "function") return;
    if (window.loadStats.__wrappedScanStats) return;
    _origLoadStats = window.loadStats;
    window.loadStats = async function () {
      await _origLoadStats();
      try {
        var r = await fetch("/api/stats");
        var s = await r.json();
        await renderScanStatsPanel(s);
        populateFilterResourceSelect();
      } catch (e) {
        console.error(e);
      }
    };
    window.loadStats.__wrappedScanStats = true;
  }

  // Add Delete button on completed cards via click delegation
  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest("[data-act=delete]") : null;
    if (!btn) return;
    var mid = btn.getAttribute("data-mid");
    if (mid) deleteMission(mid);
  });

  // After original render, inject Delete on completed missions
  var _observerInstalled = false;
  function enhanceCompletedCards() {
    var list = document.getElementById("mission-list");
    if (!list) return;
    list.querySelectorAll(".mission.complete").forEach(function (card) {
      if (card.querySelector("[data-act=delete]")) return;
      // Find mission id from Re-OCR/Abandon absence — use meta text
      var meta = card.querySelector(".mission-meta");
      if (!meta) return;
      var m = meta.textContent.match(/^([0-9a-f-]{8})/i);
      // Better: parse from any data-mid on abandon (won't exist). Search cache.
      var titleEl = card.querySelector(".mission-title");
      var title = titleEl ? titleEl.textContent : "";
      var cache = typeof missionsCache !== "undefined" ? missionsCache : [];
      var found = cache.find(function (x) {
        return x.status === "completed" && x.title === title;
      });
      if (!found && m) {
        found = cache.find(function (x) {
          return x.mission_id && x.mission_id.indexOf(m[1]) === 0;
        });
      }
      if (!found) return;
      var actions = document.createElement("div");
      actions.style.cssText = "margin-top:0.55rem;display:flex;gap:0.4rem;flex-wrap:wrap";
      actions.innerHTML =
        '<button type="button" class="btn btn-danger btn-sm" data-mid="' +
        found.mission_id +
        '" data-act="delete">Delete</button>';
      card.appendChild(actions);
    });
  }

  // Patch setFilter to store current filter on window
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

  function boot() {
    installRenderWrapper();
    installStatsWrapper();
    installSetFilterWrapper();
    populateFilterResourceSelect();

    var resEl = document.getElementById("filter-resource");
    var fromEl = document.getElementById("filter-from");
    var toEl = document.getElementById("filter-to");
    if (resEl) resEl.addEventListener("change", applyMissionFilters);
    if (fromEl) fromEl.addEventListener("change", applyMissionFilters);
    if (toEl) toEl.addEventListener("change", applyMissionFilters);

    // Enhance completed cards after mission list updates
    var list = document.getElementById("mission-list");
    if (list && !_observerInstalled) {
      _observerInstalled = true;
      var mo = new MutationObserver(function () {
        enhanceCompletedCards();
      });
      mo.observe(list, { childList: true, subtree: true });
    }

    if (typeof loadStats === "function") loadStats();
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
