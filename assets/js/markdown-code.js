(function (global) {
  "use strict";

  function getCopyableCodeBlocks(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return Array.from(root.querySelectorAll("pre")).filter(function (pre) {
      return !pre.querySelector("code.language-mermaid");
    });
  }

  function restoreFocus(element) {
    if (!element || typeof element.focus !== "function") return;
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }

  function copyWithSelection(text) {
    if (!document.body || typeof document.execCommand !== "function") {
      throw new Error("No compatible clipboard API is available.");
    }

    var activeElement = document.activeElement;
    var selection = typeof global.getSelection === "function" ? global.getSelection() : null;
    var savedRanges = [];
    if (selection) {
      for (var i = 0; i < selection.rangeCount; i++) {
        savedRanges.push(selection.getRangeAt(i).cloneRange());
      }
    }

    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.fontSize = "16px";
    document.body.appendChild(textarea);

    var copied = false;
    try {
      restoreFocus(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
      restoreFocus(activeElement);
      if (selection) {
        selection.removeAllRanges();
        savedRanges.forEach(function (range) { selection.addRange(range); });
      }
    }

    if (!copied) throw new Error("The browser rejected the clipboard fallback.");
  }

  function copyText(value) {
    var text = value == null ? "" : String(value);

    function useFallback(primaryError) {
      return new Promise(function (resolve, reject) {
        try {
          copyWithSelection(text);
          resolve();
        } catch (fallbackError) {
          fallbackError.clipboardError = primaryError || null;
          reject(fallbackError);
        }
      });
    }

    if (global.isSecureContext
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === "function") {
      try {
        return Promise.resolve(navigator.clipboard.writeText(text)).catch(useFallback);
      } catch (error) {
        return useFallback(error);
      }
    }

    return useFallback(null);
  }

  function attachCopyButtons(root, options) {
    var settings = options || {};
    var label = typeof settings.label === "function"
      ? settings.label
      : function (key) { return key; };
    var resetDelay = Number.isFinite(settings.resetDelay) ? settings.resetDelay : 1500;

    getCopyableCodeBlocks(root).forEach(function (pre) {
      if (pre.dataset.copyButtonReady === "true") return;
      pre.dataset.copyButtonReady = "true";

      var button = document.createElement("button");
      button.type = "button";
      button.className = "copy-btn";
      button.textContent = label("copy");
      button.setAttribute("aria-label", label("copy"));
      button.setAttribute("aria-live", "polite");

      var resetTimer = null;
      function showStatus(key) {
        if (resetTimer !== null) global.clearTimeout(resetTimer);
        button.textContent = label(key);
        button.setAttribute("aria-label", label(key));
        if (key !== "copy") {
          resetTimer = global.setTimeout(function () {
            button.textContent = label("copy");
            button.setAttribute("aria-label", label("copy"));
            resetTimer = null;
          }, resetDelay);
        }
      }

      button.addEventListener("click", function () {
        var code = pre.querySelector("code");
        if (!code) {
          showStatus("copyFailed");
          return;
        }

        copyText(code.textContent).then(function () {
          showStatus("copied");
        }).catch(function (error) {
          console.warn("Unable to copy code block.", error);
          showStatus("copyFailed");
        });
      });

      pre.appendChild(button);
    });
  }

  global.MarkdownCode = Object.freeze({
    attachCopyButtons: attachCopyButtons,
    copyText: copyText,
    getCopyableCodeBlocks: getCopyableCodeBlocks
  });
})(window);
