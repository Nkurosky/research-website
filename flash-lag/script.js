(() => {
  "use strict";

  // The target duration is a request to the browser. A real display presents
  // frames on its refresh schedule, so a 20 ms target can occupy one or more
  // refresh intervals. The flash is timed from performance.now(), not from a
  // counter tied to requestAnimationFrame, so a delayed frame never creates a
  // synthetic angular offset.
  const DEFAULTS = Object.freeze({
    movingColor: "#2f619c",
    flashColor: "#d1773d",
    backgroundColor: "#f4f7fa",
    centerColor: "#172638",
    movingLength: 58,
    flashLength: 24,
    gap: 0,
    movingThickness: 4,
    flashThickness: 4,
    innerRadius: 12,
    centerSize: 7,
    speedRpm: 15,
    frequencyFpm: 100,
    durationMs: 20,
    direction: "cw",
    connected: true,
    showCenter: true,
    showOrbit: true,
    angularOffset: 0
  });

  const PRESETS = Object.freeze({
    default: DEFAULTS,
    classic: {
      ...DEFAULTS,
      speedRpm: 2,
      frequencyFpm: 40,
      connected: true,
      gap: 0,
      durationMs: 20
    },
    clear: {
      ...DEFAULTS,
      speedRpm: 5,
      frequencyFpm: 60,
      connected: false,
      gap: 9,
      flashLength: 27
    },
    offset: {
      ...DEFAULTS,
      speedRpm: 15,
      frequencyFpm: 100,
      connected: false,
      gap: 0,
      angularOffset: 12
    }
  });

  const LIMITS = Object.freeze({
    movingLength: [8, 82],
    flashLength: [4, 55],
    gap: [0, 24],
    movingThickness: [1, 40],
    flashThickness: [1, 40],
    innerRadius: [0, 50],
    centerSize: [1, 20],
    speedRpm: [0, 60],
    frequencyFpm: [0, 600],
    durationMs: [1, 1000],
    angularOffset: [-180, 180]
  });

  const $ = (id) => document.getElementById(id);
  const canvas = $("stimulusCanvas");
  const stageFrame = $("stageFrame");
  const context = canvas.getContext("2d", { alpha: false });
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!context) {
    return;
  }

  let settings = { ...DEFAULTS };
  let canvasSize = { side: 1, dpr: 1 };
  let resizeFrame = 0;
  let lastPreset = "default";
  let initialReducedMotion = reducedMotionQuery.matches;

  const runtime = {
    angle: 0,
    lastTime: null,
    nextFlashAt: 0,
    pendingFlash: false,
    flash: { visible: false, angle: 0, until: 0 },
    referenceFrozen: false,
    hidden: false,
    flashCount: 0,
    paused: initialReducedMotion
  };

  const controls = {
    movingColor: $("movingColor"),
    flashColor: $("flashColor"),
    backgroundColor: $("backgroundColor"),
    centerColor: $("centerColor"),
    movingLength: $("movingLength"),
    flashLength: $("flashLength"),
    gap: $("gap"),
    movingThickness: $("movingThickness"),
    flashThickness: $("flashThickness"),
    innerRadius: $("innerRadius"),
    centerSize: $("centerSize"),
    speedRpm: $("speedRpm"),
    frequencyFpm: $("frequencyFpm"),
    durationMs: $("durationMs"),
    angularOffset: $("angularOffset"),
    connected: $("connected"),
    showCenter: $("showCenter"),
    showOrbit: $("showOrbit"),
    presetSelect: $("presetSelect")
  };

  const readouts = {
    movingColor: $("movingColorValue"),
    flashColor: $("flashColorValue"),
    backgroundColor: $("backgroundColorValue"),
    centerColor: $("centerColorValue"),
    movingLength: $("movingLengthNumber"),
    flashLength: $("flashLengthNumber"),
    gap: $("gapNumber"),
    movingThickness: $("movingThicknessNumber"),
    flashThickness: $("flashThicknessNumber"),
    innerRadius: $("innerRadiusNumber"),
    centerSize: $("centerSizeNumber"),
    speedRpm: $("speedRpmNumber"),
    frequencyFpm: $("frequencyFpmNumber"),
    durationMs: $("durationMsNumber"),
    angularOffset: $("angularOffsetNumber")
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }

  function safeBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function safeSetting(raw, key) {
    const fallback = DEFAULTS[key];
    const [min, max] = LIMITS[key];
    return clamp(finiteNumber(raw, fallback), min, max);
  }

  function sanitizeSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const next = { ...DEFAULTS };

    for (const key of Object.keys(LIMITS)) {
      next[key] = safeSetting(input[key], key);
    }
    next.movingColor = safeColor(input.movingColor, DEFAULTS.movingColor);
    next.flashColor = safeColor(input.flashColor, DEFAULTS.flashColor);
    next.backgroundColor = safeColor(input.backgroundColor, DEFAULTS.backgroundColor);
    next.centerColor = safeColor(input.centerColor, DEFAULTS.centerColor);
    next.direction = input.direction === "ccw" ? "ccw" : "cw";
    next.connected = safeBoolean(input.connected, DEFAULTS.connected);
    next.showCenter = safeBoolean(input.showCenter, DEFAULTS.showCenter);
    next.showOrbit = safeBoolean(input.showOrbit, DEFAULTS.showOrbit);
    return next;
  }

  function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function normalizedDegrees(radians) {
    const degrees = radians * 180 / Math.PI;
    return ((degrees % 360) + 360) % 360;
  }

  function signedDegrees(radians) {
    const degrees = normalizedDegrees(radians);
    return degrees > 180 ? degrees - 360 : degrees;
  }

  function formatNumber(value, digits = 0) {
    return Number(value).toFixed(digits).replace(/\.0+$/, "");
  }

  function formatColor(value) {
    return value.toUpperCase();
  }

  function intervalMs() {
    return settings.frequencyFpm > 0 ? 60000 / settings.frequencyFpm : Infinity;
  }

  function setRangeFill(input) {
    if (!input || input.type !== "range") return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const percentage = clamp((value - min) / (max - min || 1), 0, 1) * 100;
    input.style.setProperty("--value", `${percentage}%`);
  }

  function updateControlVisuals() {
    for (const [key, control] of Object.entries(controls)) {
      if (!control || key === "presetSelect") continue;
      if (control.type === "checkbox") {
        control.checked = Boolean(settings[key]);
      } else if (control.type === "color" || control.type === "range") {
        control.value = String(settings[key]);
        setRangeFill(control);
      }
    }

    controls.gap.disabled = settings.connected;
    controls.gap.setAttribute("aria-disabled", String(settings.connected));
    const gapNumber = $("gapNumber");
    gapNumber.disabled = settings.connected;
    gapNumber.setAttribute("aria-disabled", String(settings.connected));

    for (const [key, output] of Object.entries(readouts)) {
      if (!output) continue;
      const value = settings[key];
      if (output.tagName === "INPUT" && output.type === "number") {
        if (key === "speedRpm" || key === "movingThickness" || key === "flashThickness") {
          output.value = formatNumber(value, 1);
        } else {
          output.value = formatNumber(value);
        }
      } else if (key.endsWith("Color")) {
        output.textContent = formatColor(value);
      } else if (key === "speedRpm") {
        output.textContent = `${formatNumber(value, 1)} rpm`;
      } else if (key === "frequencyFpm") {
        output.textContent = `${formatNumber(value)} fpm`;
      } else if (key === "durationMs") {
        output.textContent = `${formatNumber(value)} ms`;
      } else if (key === "movingThickness" || key === "flashThickness") {
        output.textContent = `${formatNumber(value, 1)} px`;
      } else if (key === "angularOffset") {
        output.textContent = `${formatNumber(value)}°`;
      } else {
        output.textContent = `${formatNumber(value)}%`;
      }
    }

    $("rotationReadout").textContent = `${formatNumber(settings.speedRpm, 1)} rpm`;
    $("cadenceReadout").textContent = `${formatNumber(settings.frequencyFpm)} fpm`;
    $("durationReadout").textContent = `${formatNumber(settings.durationMs)} ms`;
    $("motionSummary").textContent = `${formatNumber(settings.speedRpm, 1)} rpm · ${formatNumber(settings.frequencyFpm)} fpm`;
    $("geometrySummary").textContent = `${formatNumber(settings.innerRadius)}% inner · ${settings.connected ? "0" : formatNumber(settings.gap)}% gap`;
    $("guidesSummary").textContent = `Center ${settings.showCenter ? "on" : "off"} · Orbit ${settings.showOrbit ? "on" : "off"}`;
    $("alignmentSummary").textContent = `${settings.angularOffset > 0 ? "+" : ""}${formatNumber(settings.angularOffset)}° offset`;
    controls.presetSelect.value = lastPreset;

    for (const directionButton of document.querySelectorAll("[data-direction]")) {
      const selected = directionButton.dataset.direction === settings.direction;
      directionButton.classList.toggle("is-selected", selected);
      directionButton.setAttribute("aria-pressed", String(selected));
    }
  }

  function resetFlashSchedule(now = performance.now()) {
    runtime.nextFlashAt = now + intervalMs();
    runtime.pendingFlash = false;
  }

  function applySettings(raw, options = {}) {
    const previousFrequency = settings.frequencyFpm;
    settings = sanitizeSettings(raw);
    if (runtime.referenceFrozen) {
      runtime.flash.angle = runtime.angle + degreesToRadians(settings.angularOffset);
      runtime.flash.until = Infinity;
      runtime.flash.visible = true;
    }
    updateControlVisuals();
    if (options.resetSchedule || previousFrequency !== settings.frequencyFpm || !runtime.nextFlashAt) {
      resetFlashSchedule();
    }
    updateStatus();
    draw(performance.now());
  }

  function setCustomPreset() {
    lastPreset = "custom";
    controls.presetSelect.value = "custom";
  }

  function setSettingsFromControl(key, value) {
    const raw = { ...settings, [key]: value };
    applySettings(raw);
    setCustomPreset();
  }

  function getGeometry(side) {
    const radius = side * 0.5;
    const rawInner = radius * (settings.innerRadius / 100);
    const rawMovingLength = radius * (settings.movingLength / 100);
    const rawGap = settings.connected ? 0 : radius * (settings.gap / 100);
    const rawFlashLength = radius * (settings.flashLength / 100);
    const requestedExtent = rawInner + rawMovingLength + rawGap + rawFlashLength;
    // Keep a clear margin around the stage. The half-thickness term accounts
    // for round line caps; all radial distances are then scaled together so
    // the construction keeps its proportions instead of truncating one line.
    const margin = Math.min(Math.max(4, radius * 0.08), 14, radius * 0.35);
    const requestedMaxThickness = Math.max(settings.movingThickness, settings.flashThickness);
    const maxStroke = Math.max(1, Math.min(requestedMaxThickness, radius * 2 - margin * 2));
    const halfMaxThickness = maxStroke * 0.5;
    const availableRadius = Math.max(0, radius - margin - halfMaxThickness);
    const uniformScale = requestedExtent > 0 ? Math.min(1, availableRadius / requestedExtent) : 0;
    const inner = rawInner * uniformScale;
    const movingLength = rawMovingLength * uniformScale;
    const effectiveGap = rawGap * uniformScale;
    const flashLength = rawFlashLength * uniformScale;
    const movingEnd = inner + movingLength;
    const flashStart = movingEnd + effectiveGap;
    return {
      center: side * 0.5,
      inner,
      movingLength,
      flashStart,
      flashLength,
      requestedExtent,
      availableRadius,
      uniformScale,
      maxStroke
    };
  }

  function drawSegment(angle, start, length, color, thickness, geometry) {
    if (length <= 0) return;
    const x0 = geometry.center + Math.cos(angle) * start;
    const y0 = geometry.center + Math.sin(angle) * start;
    const x1 = geometry.center + Math.cos(angle) * (start + length);
    const y1 = geometry.center + Math.sin(angle) * (start + length);
    context.save();
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.lineWidth = Math.max(1, thickness);
    context.lineCap = "round";
    context.strokeStyle = color;
    context.stroke();
    context.restore();
  }

  function draw(now = performance.now()) {
    const side = canvasSize.side;
    const geometry = getGeometry(side);
    const angle = runtime.angle;
    const effectiveFlashAngle = runtime.flash.angle;

    context.save();
    context.clearRect(0, 0, side, side);
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, side, side);

    if (settings.showOrbit) {
      context.save();
      context.beginPath();
      context.arc(geometry.center, geometry.center, geometry.inner, 0, Math.PI * 2);
      context.setLineDash([3, 6]);
      context.lineWidth = Math.max(1, side * 0.0012);
      context.strokeStyle = `${settings.centerColor}55`;
      context.stroke();
      context.restore();
    }

    drawSegment(angle, geometry.inner, geometry.movingLength, settings.movingColor, Math.min(settings.movingThickness, geometry.maxStroke), geometry);

    if (runtime.flash.visible) {
      drawSegment(effectiveFlashAngle, geometry.flashStart, geometry.flashLength, settings.flashColor, Math.min(settings.flashThickness, geometry.maxStroke), geometry);
    }

    if (settings.showCenter) {
      context.save();
      context.beginPath();
      context.arc(geometry.center, geometry.center, Math.max(2, side * (settings.centerSize / 100) * 0.5), 0, Math.PI * 2);
      context.fillStyle = settings.centerColor;
      context.fill();
      context.restore();
    }
    context.restore();

    $("phaseReadout").textContent = `${formatNumber(signedDegrees(angle), 1)}°`;
    stageFrame.classList.toggle("is-flashing", runtime.flash.visible);
    if (now) {
      stageFrame.dataset.lastFrame = String(now);
    }
  }

  function triggerFlash(now = performance.now()) {
    // This capture happens immediately before the draw for the first visible
    // flash frame. With offset = 0, the two line angles are identical.
    runtime.flash.angle = runtime.angle + degreesToRadians(settings.angularOffset);
    runtime.flash.until = now + settings.durationMs;
    runtime.flash.visible = true;
    runtime.flashCount += 1;
  }

  function requestSingleFlash() {
    runtime.pendingFlash = true;
    if (!runtime.lastTime) runtime.lastTime = performance.now();
  }

  function setPaused(paused) {
    if (runtime.referenceFrozen && !paused) return;
    runtime.paused = Boolean(paused);
    if (runtime.paused) {
      runtime.flash.visible = false;
      runtime.pendingFlash = false;
    } else {
      runtime.lastTime = performance.now();
      resetFlashSchedule(runtime.lastTime);
    }
    updateStatus();
  }

  function togglePause() {
    if (runtime.referenceFrozen) {
      releaseReference();
      return;
    }
    setPaused(!runtime.paused);
  }

  function freezeReference() {
    runtime.referenceFrozen = true;
    runtime.paused = true;
    runtime.pendingFlash = false;
    runtime.flash.angle = runtime.angle + degreesToRadians(settings.angularOffset);
    runtime.flash.until = Infinity;
    runtime.flash.visible = true;
    updateStatus();
    draw(performance.now());
  }

  function releaseReference() {
    runtime.referenceFrozen = false;
    runtime.paused = false;
    runtime.flash.visible = false;
    runtime.flash.until = 0;
    runtime.lastTime = performance.now();
    resetFlashSchedule(runtime.lastTime);
    updateStatus();
  }

  function updateStatus() {
    const pill = $("statusPill");
    const text = $("statusText");
    const paused = runtime.paused && !runtime.referenceFrozen;
    pill.classList.toggle("is-paused", paused);
    pill.classList.toggle("is-frozen", runtime.referenceFrozen);
    text.textContent = runtime.referenceFrozen ? "Reference frozen" : paused ? "Paused" : "Running";
    $("pauseButtonLabel").textContent = runtime.paused ? "Resume" : "Pause";
    $("pauseButtonIcon").textContent = runtime.paused ? "▶" : "Ⅱ";
    $("freezeButtonLabel").textContent = runtime.referenceFrozen ? "Release reference" : "Freeze reference";
    const offsetText = `${settings.angularOffset > 0 ? "+" : ""}${formatNumber(settings.angularOffset)}°`;
    $("stageHint").textContent = runtime.referenceFrozen
      ? Math.abs(settings.angularOffset) < 0.0001 ? "Exact alignment reference" : `Frozen reference · ${offsetText} offset`
      : runtime.paused ? "Press Space to resume" : "Space to pause";
  }

  function resizeCanvas() {
    const rect = stageFrame.getBoundingClientRect();
    const side = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(side * dpr));
    canvas.height = Math.max(1, Math.round(side * dpr));
    canvasSize = { side, dpr };
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function scheduleResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeCanvas();
    });
  }

  function animationFrame(now) {
    if (document.hidden) {
      runtime.hidden = true;
      requestAnimationFrame(animationFrame);
      return;
    }

    if (runtime.lastTime === null) {
      runtime.lastTime = now;
      if (!runtime.nextFlashAt) resetFlashSchedule(now);
    }

    const elapsed = Math.max(0, now - runtime.lastTime);
    const safeElapsed = elapsed > 250 ? 0 : elapsed;
    runtime.lastTime = now;

    if (runtime.hidden) {
      runtime.hidden = false;
      resetFlashSchedule(now);
      if (runtime.referenceFrozen) {
        runtime.flash.angle = runtime.angle + degreesToRadians(settings.angularOffset);
        runtime.flash.until = Infinity;
        runtime.flash.visible = true;
      } else {
        runtime.flash.visible = false;
      }
    }

    if (!runtime.paused && !runtime.referenceFrozen) {
      const sign = settings.direction === "ccw" ? -1 : 1;
      runtime.angle += sign * settings.speedRpm * (Math.PI * 2 / 60000) * safeElapsed;
    }

    if (runtime.pendingFlash && !runtime.flash.visible) {
      triggerFlash(now);
      runtime.pendingFlash = false;
    } else if (!runtime.paused && !runtime.referenceFrozen && !runtime.flash.visible && now >= runtime.nextFlashAt) {
      // Rebase after a late frame instead of replaying missed flashes in a
      // burst. This prevents stale flash events after a background tab.
      triggerFlash(now);
      runtime.nextFlashAt = now + intervalMs();
    }

    if (runtime.flash.visible && !runtime.referenceFrozen && now >= runtime.flash.until) {
      runtime.flash.visible = false;
    }

    draw(now);
    requestAnimationFrame(animationFrame);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64ToBytes(encoded) {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function encodeSettings(raw = settings) {
    const payload = JSON.stringify({ v: 1, settings: sanitizeSettings(raw) });
    return bytesToBase64(new TextEncoder().encode(payload));
  }

  function decodeSettings(encoded) {
    if (!encoded || encoded.length > 5000) return null;
    try {
      const decoded = new TextDecoder().decode(base64ToBytes(encoded));
      const payload = JSON.parse(decoded);
      return payload && typeof payload === "object" ? sanitizeSettings(payload.settings || payload) : null;
    } catch (_error) {
      return null;
    }
  }

  function currentShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("cfg", encodeSettings());
    return url.toString();
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      temporary.remove();
    }
    return copied;
  }

  async function shareSettings() {
    const url = currentShareUrl();
    window.history.replaceState(null, "", url);
    const copied = await copyText(url).catch(() => false);
    $("shareButtonLabel").textContent = copied ? "Link copied" : "Share URL ready";
    $("shareStatus").textContent = copied ? "Settings copied to the clipboard." : "Settings are encoded in the address bar.";
    window.setTimeout(() => {
      $("shareButtonLabel").textContent = "Copy share link";
    }, 2400);
  }

  function clearShareConfig() {
    const url = new URL(window.location.href);
    url.searchParams.delete("cfg");
    window.history.replaceState(null, "", url);
  }

  function applyPreset(name) {
    if (!PRESETS[name]) return;
    lastPreset = name;
    applySettings(PRESETS[name], { resetSchedule: true });
  }

  function handleInput(event) {
    const target = event.target;
    const key = target.dataset.numberFor || target.id;
    if (!key || !(key in settings)) return;
    let value;
    if (target.type === "checkbox") {
      value = target.checked;
    } else if (target.type === "color") {
      value = target.value;
    } else {
      value = Number(target.value);
    }
    setSettingsFromControl(key, value);
    if (key === "frequencyFpm") resetFlashSchedule();
  }

  function handleDirection(event) {
    const button = event.target.closest("[data-direction]");
    if (!button) return;
    setSettingsFromControl("direction", button.dataset.direction);
  }

  function handleKeydown(event) {
    const target = event.target;
    if (target && (target.matches("input, select, textarea, button") || target.isContentEditable)) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === "f") {
      requestSingleFlash();
    } else if (event.key.toLowerCase() === "r") {
      applyPreset("default");
      clearShareConfig();
    }
  }

  function handleVisibility() {
    if (document.hidden) {
      runtime.hidden = true;
      return;
    }
    runtime.lastTime = performance.now();
    if (runtime.referenceFrozen) {
      runtime.flash.angle = runtime.angle + degreesToRadians(settings.angularOffset);
      runtime.flash.until = Infinity;
      runtime.flash.visible = true;
    } else {
      runtime.flash.visible = false;
    }
    resetFlashSchedule(runtime.lastTime);
    updateStatus();
  }

  function handleFullscreenChange() {
    const isFullscreen = document.fullscreenElement === stageFrame;
    $("fullscreenButton").setAttribute("aria-label", isFullscreen ? "Exit fullscreen stage" : "Enter fullscreen stage");
    $("fullscreenButton").querySelector(".fullscreen-label").textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
    scheduleResize();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stageFrame.requestFullscreen) {
        await stageFrame.requestFullscreen();
      }
    } catch (_error) {
      // Fullscreen can be denied by an embedding context; the stage remains usable.
    }
  }

  function attachListeners() {
    for (const input of document.querySelectorAll("input[type=range], input[type=color], input[type=checkbox], input[type=number]")) {
      input.addEventListener("input", handleInput);
      input.addEventListener("change", handleInput);
    }
    document.querySelector(".segmented").addEventListener("click", handleDirection);
    controls.presetSelect.addEventListener("change", () => {
      applyPreset(controls.presetSelect.value);
    });
    $("pauseButton").addEventListener("click", togglePause);
    $("singleFlashButton").addEventListener("click", requestSingleFlash);
    $("freezeButton").addEventListener("click", () => {
      if (runtime.referenceFrozen) releaseReference();
      else freezeReference();
    });
    $("resetButton").addEventListener("click", () => {
      applyPreset("default");
      clearShareConfig();
      $("shareStatus").textContent = "Defaults restored.";
    });
    $("shareButton").addEventListener("click", shareSettings);
    $("fullscreenButton").addEventListener("click", toggleFullscreen);
    $("fullscreenExitButton").addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch (_error) {
        // The browser may reject an exit request from an embedding context.
      }
    });
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("resize", scheduleResize, { passive: true });
    if ("ResizeObserver" in window) {
      new ResizeObserver(scheduleResize).observe(stageFrame);
    }
    reducedMotionQuery.addEventListener?.("change", (event) => {
      if (event.matches) {
        runtime.paused = true;
        runtime.flash.visible = false;
        updateStatus();
      }
    });
  }

  function readInitialSettings() {
    const params = new URLSearchParams(window.location.search);
    const imported = decodeSettings(params.get("cfg"));
    if (imported) {
      settings = imported;
      lastPreset = "custom";
    }
  }

  function init() {
    readInitialSettings();
    updateControlVisuals();
    attachListeners();
    updateStatus();
    resizeCanvas();
    requestAnimationFrame(animationFrame);

    // A tiny public surface makes manual browser QA easier without coupling
    // the page to a test runner or a framework.
    window.flashLagDemo = Object.freeze({
      getSettings: () => ({ ...settings }),
      getGeometry: () => ({ ...getGeometry(canvasSize.side) }),
      getRuntime: () => ({ angle: runtime.angle, flashCount: runtime.flashCount, paused: runtime.paused, referenceFrozen: runtime.referenceFrozen }),
      getFlash: () => ({ visible: runtime.flash.visible, angle: runtime.flash.angle, until: runtime.flash.until }),
      singleFlash: requestSingleFlash,
      reset: () => applyPreset("default")
    });
  }

  init();
})();
