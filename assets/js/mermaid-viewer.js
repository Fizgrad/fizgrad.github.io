(function (global) {
  "use strict";

  var document = global.document;
  if (!document) return;

  var MIN_SCALE = 0.1;
  var MAX_SCALE = 3;
  var SCALE_STEP = 0.1;
  var INITIAL_SCALE = 0.8;
  var states = new WeakMap();
  var activeWrapper = null;
  var listenersReady = false;
  var resizePending = false;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function text(state, key, fallback) {
    if (typeof state.label === "function") {
      var translated = state.label(key);
      if (translated && translated !== key) return translated;
    }
    return fallback;
  }

  function findWrappers(root) {
    if (!root) return [];
    var wrappers = [];
    if (root.matches && root.matches(".mermaid-wrapper")) wrappers.push(root);
    if (root.querySelectorAll) {
      wrappers = wrappers.concat(Array.from(root.querySelectorAll(".mermaid-wrapper")));
    }
    return wrappers;
  }

  function getSvg(state) {
    return state.diagram.querySelector("svg");
  }

  function measure(state) {
    var svg = getSvg(state);
    if (!svg) return false;

    var width = 0;
    var height = 0;
    if (svg.viewBox && svg.viewBox.baseVal) {
      width = svg.viewBox.baseVal.width;
      height = svg.viewBox.baseVal.height;
    }

    if (!width || !height) {
      var viewBox = (svg.getAttribute("viewBox") || "").trim().split(/\s+/);
      if (viewBox.length === 4) {
        width = parseFloat(viewBox[2]);
        height = parseFloat(viewBox[3]);
      }
    }

    if (!width || !height) {
      var rect = svg.getBoundingClientRect();
      width = rect.width || parseFloat(svg.getAttribute("width")) || 500;
      height = rect.height || parseFloat(svg.getAttribute("height")) || 300;
    }

    state.baseWidth = width;
    state.baseHeight = height;
    return true;
  }

  function updateControls(state) {
    var zoomInLabel = text(state, "zoomIn", "Zoom in");
    var zoomOutLabel = text(state, "zoomOut", "Zoom out");
    var fullscreenLabel = state.active
      ? text(state, "exitFullscreen", "Back to document")
      : text(state, "fullscreen", "Expand diagram to fill page");

    state.controls.setAttribute(
      "aria-label",
      text(state, "diagramControls", "Diagram controls")
    );
    state.zoomIn.setAttribute("aria-label", zoomInLabel);
    state.zoomIn.setAttribute("title", zoomInLabel);
    state.zoomOut.setAttribute("aria-label", zoomOutLabel);
    state.zoomOut.setAttribute("title", zoomOutLabel);
    state.zoomIn.disabled = state.scale >= MAX_SCALE - 0.001;
    state.zoomOut.disabled = state.scale <= MIN_SCALE + 0.001;

    state.fullscreen.setAttribute("aria-label", fullscreenLabel);
    state.fullscreen.setAttribute("title", fullscreenLabel);
    state.fullscreen.setAttribute("aria-pressed", String(state.active));
    if (state.active) {
      state.fullscreen.textContent = "\u2190 " + fullscreenLabel;
    } else {
      state.fullscreen.replaceChildren(state.fullscreenIcon);
    }
  }

  function applyScale(state) {
    var svg = getSvg(state);
    if (!svg && !measure(state)) return;
    svg = getSvg(state);
    if (!state.baseWidth || !state.baseHeight) {
      if (!measure(state)) return;
    }

    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "none";
    svg.style.width = Math.max(1, state.baseWidth * state.scale) + "px";
    svg.style.height = Math.max(1, state.baseHeight * state.scale) + "px";
    state.wrapper.dataset.mermaidScale = state.scale.toFixed(2);
    updateControls(state);
  }

  function centerAfterResize(state, horizontalRatio, verticalRatio) {
    global.requestAnimationFrame(function () {
      var scroll = state.scroll;
      scroll.scrollLeft = Math.max(0, scroll.scrollWidth * horizontalRatio - scroll.clientWidth / 2);
      scroll.scrollTop = Math.max(0, scroll.scrollHeight * verticalRatio - scroll.clientHeight / 2);
    });
  }

  function changeScale(state, delta) {
    if (!state.baseWidth && !measure(state)) return;

    var scroll = state.scroll;
    var horizontalRatio = scroll.scrollWidth
      ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth
      : 0.5;
    var verticalRatio = scroll.scrollHeight
      ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight
      : 0.5;

    state.scale = clamp(
      Math.round((state.scale + delta) * 100) / 100,
      MIN_SCALE,
      MAX_SCALE
    );
    applyScale(state);
    centerAfterResize(state, horizontalRatio, verticalRatio);
  }

  function fitPageFullscreen(state) {
    if (!measure(state)) return;

    var scrollStyle = global.getComputedStyle(state.scroll);
    var horizontalPadding = (parseFloat(scrollStyle.paddingLeft) || 0)
      + (parseFloat(scrollStyle.paddingRight) || 0);
    var verticalPadding = (parseFloat(scrollStyle.paddingTop) || 0)
      + (parseFloat(scrollStyle.paddingBottom) || 0);
    var scrollWidth = state.scroll.clientWidth || state.wrapper.clientWidth;
    var scrollHeight = state.scroll.clientHeight || state.wrapper.clientHeight;
    var availableWidth = Math.max(1, scrollWidth - horizontalPadding);
    var availableHeight = Math.max(1, scrollHeight - verticalPadding);
    state.scale = clamp(
      Math.min(availableWidth / state.baseWidth, availableHeight / state.baseHeight),
      MIN_SCALE,
      MAX_SCALE
    );
    applyScale(state);
    centerAfterResize(state, 0.5, 0.5);
  }

  function savePosition(state) {
    state.restore = {
      scale: state.scale,
      scrollLeft: state.scroll.scrollLeft,
      scrollTop: state.scroll.scrollTop,
      pageX: global.scrollX || 0,
      pageY: global.scrollY || 0
    };
  }

  function restorePosition(state) {
    var restore = state.restore;
    if (!restore) return;

    state.scale = restore.scale;
    applyScale(state);
    global.requestAnimationFrame(function () {
      state.scroll.scrollLeft = restore.scrollLeft;
      state.scroll.scrollTop = restore.scrollTop;
      if (document.activeElement !== state.fullscreen) {
        try {
          state.fullscreen.focus({ preventScroll: true });
        } catch (error) {
          state.fullscreen.focus();
        }
      }
      try {
        global.scrollTo({ left: restore.pageX, top: restore.pageY, behavior: "auto" });
      } catch (error) {
        global.scrollTo(restore.pageX, restore.pageY);
      }
      state.restore = null;
    });
  }

  function setActive(state, active) {
    if (state.active === active) {
      updateControls(state);
      return;
    }

    state.active = active;
    state.wrapper.classList.toggle("is-mermaid-page-fullscreen", active);
    if (active) {
      activeWrapper = state.wrapper;
      document.body.classList.add("mermaid-page-fullscreen-open");
      updateControls(state);
      global.requestAnimationFrame(function () {
        fitPageFullscreen(state);
      });
      return;
    }

    document.body.classList.remove("mermaid-page-fullscreen-open");
    if (state.pagePlaceholder && state.pagePlaceholder.parentNode) {
      state.pagePlaceholder.parentNode.insertBefore(
        state.wrapper,
        state.pagePlaceholder
      );
      state.pagePlaceholder.remove();
    } else if (state.pagePlaceholder && !state.pagePlaceholder.parentNode) {
      state.wrapper.remove();
    }
    state.pagePlaceholder = null;
    if (activeWrapper === state.wrapper) activeWrapper = null;
    updateControls(state);
    restorePosition(state);
  }

  function enterPageFullscreen(state) {
    if (state.active) return;
    if (activeWrapper && activeWrapper !== state.wrapper && states.has(activeWrapper)) {
      setActive(states.get(activeWrapper), false);
    }

    savePosition(state);
    if (state.wrapper.parentNode && state.wrapper.parentNode !== document.body) {
      state.pagePlaceholder = document.createComment("mermaid-page-fullscreen-placeholder");
      state.wrapper.parentNode.insertBefore(state.pagePlaceholder, state.wrapper);
      document.body.appendChild(state.wrapper);
    }
    setActive(state, true);
  }

  function leavePageFullscreen(state) {
    if (state.active) setActive(state, false);
  }

  function togglePageFullscreen(state) {
    if (state.active) leavePageFullscreen(state);
    else enterPageFullscreen(state);
  }

  function ensureGlobalListeners() {
    if (listenersReady) return;
    listenersReady = true;
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && activeWrapper && states.has(activeWrapper)) {
        event.preventDefault();
        leavePageFullscreen(states.get(activeWrapper));
      }
    });
    global.addEventListener("resize", function () {
      if (resizePending || !activeWrapper || !states.has(activeWrapper)) return;
      resizePending = true;
      global.requestAnimationFrame(function () {
        resizePending = false;
        if (activeWrapper && states.has(activeWrapper)) {
          fitPageFullscreen(states.get(activeWrapper));
        }
      });
    });
  }

  function makeButton(className, action, symbol) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-control-btn " + className;
    button.dataset.action = action;
    button.textContent = symbol;
    return button;
  }

  function makeFullscreenIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mermaid-fullscreen-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5");
    svg.appendChild(path);
    return svg;
  }

  function createDiagram(source, options) {
    var settings = options || {};
    var wrapper = document.createElement("div");
    wrapper.className = "mermaid-wrapper";

    var scroll = document.createElement("div");
    scroll.className = "mermaid-scroll";
    var diagram = document.createElement("div");
    diagram.className = "mermaid";
    diagram.textContent = source;
    scroll.appendChild(diagram);

    var controls = document.createElement("div");
    controls.className = "mermaid-controls";
    controls.setAttribute("role", "toolbar");
    var zoomIn = makeButton("mermaid-zoom-btn", "zoom-in", "+");
    zoomIn.dataset.zoom = "in";
    var zoomOut = makeButton("mermaid-zoom-btn", "zoom-out", "\u2212");
    zoomOut.dataset.zoom = "out";
    var fullscreen = makeButton("mermaid-fullscreen-btn", "fullscreen", "");
    var fullscreenIcon = makeFullscreenIcon();
    fullscreen.appendChild(fullscreenIcon);
    controls.appendChild(zoomIn);
    controls.appendChild(zoomOut);
    controls.appendChild(fullscreen);

    wrapper.appendChild(scroll);
    wrapper.appendChild(controls);

    var state = {
      wrapper: wrapper,
      scroll: scroll,
      diagram: diagram,
      controls: controls,
      zoomIn: zoomIn,
      zoomOut: zoomOut,
      fullscreen: fullscreen,
      fullscreenIcon: fullscreenIcon,
      label: settings.label,
      scale: INITIAL_SCALE,
      baseWidth: 0,
      baseHeight: 0,
      restore: null,
      pagePlaceholder: null,
      active: false
    };
    states.set(wrapper, state);
    ensureGlobalListeners();

    zoomIn.addEventListener("click", function () {
      changeScale(state, SCALE_STEP);
    });
    zoomOut.addEventListener("click", function () {
      changeScale(state, -SCALE_STEP);
    });
    fullscreen.addEventListener("click", function () {
      togglePageFullscreen(state);
    });
    updateControls(state);
    return wrapper;
  }

  function refresh(root) {
    findWrappers(root || document).forEach(function (wrapper) {
      var state = states.get(wrapper);
      if (!state || !measure(state)) return;
      if (state.active) fitPageFullscreen(state);
      else applyScale(state);
    });
  }

  function updateLabels(root, label) {
    var wrappers = findWrappers(root || document);
    wrappers.forEach(function (wrapper) {
      var state = states.get(wrapper);
      if (!state) return;
      state.label = label;
      updateControls(state);
    });
    // Page fullscreen temporarily moves the active wrapper under <body>.
    // Keep its labels in sync even when callers update only their content root.
    if (activeWrapper && wrappers.indexOf(activeWrapper) === -1 && states.has(activeWrapper)) {
      var activeState = states.get(activeWrapper);
      activeState.label = label;
      updateControls(activeState);
    }
  }

  global.MermaidViewer = Object.freeze({
    createDiagram: createDiagram,
    refresh: refresh,
    updateLabels: updateLabels
  });
})(window);
