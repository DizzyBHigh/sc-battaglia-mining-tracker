/**
 * In-app modal dialogs — replaces native alert() / confirm().
 * Usage:
 *   await showAlert("Something happened");
 *   if (await showConfirm("Delete this?")) { ... }
 */
(function () {
  var root = null;
  var titleEl = null;
  var bodyEl = null;
  var okBtn = null;
  var cancelBtn = null;
  var resolveFn = null;

  function ensureDom() {
    if (root) return;
    root = document.createElement("div");
    root.id = "app-modal";
    root.className = "modal-root";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="modal-backdrop" data-modal-dismiss="1"></div>' +
      '<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '  <h3 class="modal-title" id="modal-title"></h3>' +
      '  <p class="modal-body" id="modal-body"></p>' +
      '  <div class="modal-actions">' +
      '    <button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button>' +
      '    <button type="button" class="btn" id="modal-ok">OK</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(root);
    titleEl = root.querySelector("#modal-title");
    bodyEl = root.querySelector("#modal-body");
    okBtn = root.querySelector("#modal-ok");
    cancelBtn = root.querySelector("#modal-cancel");

    root.addEventListener("click", function (ev) {
      if (ev.target && ev.target.getAttribute("data-modal-dismiss") === "1") {
        closeModal(false);
      }
    });
    okBtn.addEventListener("click", function () {
      closeModal(true);
    });
    cancelBtn.addEventListener("click", function () {
      closeModal(false);
    });
    document.addEventListener("keydown", function (ev) {
      if (!root || !root.classList.contains("open")) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeModal(false);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        closeModal(true);
      }
    });
  }

  function closeModal(result) {
    if (!root || !root.classList.contains("open")) return;
    root.classList.remove("open");
    root.setAttribute("aria-hidden", "true");
    var fn = resolveFn;
    resolveFn = null;
    if (fn) fn(result);
  }

  function openModal(opts) {
    ensureDom();
    opts = opts || {};
    var isConfirm = !!opts.confirm;
    titleEl.textContent = opts.title || (isConfirm ? "Confirm" : "Notice");
    bodyEl.textContent = opts.message || "";
    okBtn.textContent = opts.okText || (isConfirm ? "Yes" : "OK");
    cancelBtn.textContent = opts.cancelText || "Cancel";
    cancelBtn.style.display = isConfirm ? "" : "none";

    okBtn.className = "btn" + (opts.danger ? " btn-danger" : isConfirm ? " btn-orange" : "");

    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    setTimeout(function () {
      okBtn.focus();
    }, 30);

    return new Promise(function (resolve) {
      resolveFn = resolve;
    });
  }

  /** Alert-style: one OK button. Resolves when dismissed. */
  function showAlert(message, options) {
    options = options || {};
    return openModal({
      title: options.title || "Notice",
      message: message,
      confirm: false,
      okText: options.okText || "OK",
      danger: !!options.danger,
    }).then(function () {
      return undefined;
    });
  }

  /** Confirm-style: Yes / Cancel. Resolves to true/false. */
  function showConfirm(message, options) {
    options = options || {};
    return openModal({
      title: options.title || "Confirm",
      message: message,
      confirm: true,
      okText: options.okText || "Yes",
      cancelText: options.cancelText || "Cancel",
      danger: options.danger !== false,
    });
  }

  window.showAlert = showAlert;
  window.showConfirm = showConfirm;
})();
