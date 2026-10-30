(() => {
  "use strict";

  // The target duration is a request to the browser. A real display presents
  // frames on its refresh schedule, so a 20 ms target can occupy one or more
  // refresh intervals. Flash angles are captured from the moving geometry in
  // the same animation frame in which the flash first becomes visible.
  const TWO_PI = Math.PI * 2;
  const DEFAULT_PHASES = Object.freeze([0, 180, 90, 270]);
  const DEFAULT_DIRECTIONS = Object.freeze(["cw", "cw", "cw", "cw"]);
  const LAYOUT_LABELS = Object.freeze({
    single: "Single circle",
    "two-horizontal": "2 horizontal",
    "two-vertical": "2 vertical",
    "two-diagonal-tlbr": "2 diagonal TL → BR",
    "two-diagonal-trbl": "2 diagonal TR → BL",
    "four-corners": "4 corners"
  });
  const LAYOUTS = new Set(Object.keys(LAYOUT_LABELS));
  const FLASH_MODES = new Set(["timed", "alignment"]);
  const PAIR_MODES = new Set(["across", "diagonal"]);

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
    angularOffset: 0,
    layout: "single",
    circleSpacing: 52,
    circleScale: 100,
    showPairGuides: false,
    flashMode: "timed",
    alignmentAngle: 0,
    pairMode: "across",
    phases: DEFAULT_PHASES,
    directions: DEFAULT_DIRECTIONS
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
    angularOffset: [-180, 180],
    circleSpacing: [20, 70],
    circleScale: [20, 100],
    alignmentAngle: [-180, 180]
  });

  const $ = (id) => document.getElementById(id);
  const canvas = $("stimulusCanvas");
  const stageFrame = $("stageFrame");
  const context = canvas.getContext("2d", { alpha: false });
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!context) return;

  let settings = cloneSettings(DEFAULTS);
  let canvasSize = { side: 1, dpr: 1 };
  let resizeFrame = 0;
  let lastPreset = "default";
  const initialReducedMotion = reducedMotionQuery.matches;

  const runtime = {
    // The base angle is deliberately unwrapped. Each circle applies its
    // signed direction and phase at draw/capture time.
    angle: 0,
    lastTime: null,
    nextFlashAt: 0,
    pendingFlash: false,
    flash: { visible: false, angle: 0, angles: [], until: 0 },
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
    layoutSelect: $("layoutSelect"),
    circleSpacing: $("circleSpacing"),
    circleScale: $("circleScale"),
    showPairGuides: $("showPairGuides"),
    flashMode: $("flashMode"),
    alignmentAngle: $("alignmentAngle"),
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
    angularOffset: $("angularOffsetNumber"),
    circleSpacing: $("circleSpacingNumber"),
    circleScale: $("circleScaleNumber"),
    alignmentAngle: $("alignmentAngleNumber")
  };

  function cloneSettings(raw) {
    const source = raw || DEFAULTS;
    return {
      ...source,
      phases: Array.isArray(source.phases) ? [...source.phases] : [...DEFAULT_PHASES],
      directions: Array.isArray(source.directions) ? [...source.directions] : [...DEFAULT_DIRECTIONS]
    };
  }

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

  function safePhase(raw, fallback) {
    return clamp(finiteNumber(raw, fallback), -360, 360);
  }

  function safeDirection(raw, fallback = "cw") {
    return raw === "ccw" || raw === "cw" ? raw : fallback;
  }

  function sanitizeSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const next = { ...DEFAULTS };

    for (const key of Object.keys(LIMITS)) next[key] = safeSetting(input[key], key);
    next.movingColor = safeColor(input.movingColor, DEFAULTS.movingColor);
    next.flashColor = safeColor(input.flashColor, DEFAULTS.flashColor);
    next.backgroundColor = safeColor(input.backgroundColor, DEFAULTS.backgroundColor);
    next.centerColor = safeColor(input.centerColor, DEFAULTS.centerColor);
    const suppliedDirections = Array.isArray(input.directions) ? input.directions : [];
    const legacyDirection = safeDirection(input.direction, suppliedDirections.length ? safeDirection(suppliedDirections[0], DEFAULTS.direction) : DEFAULTS.direction);
    next.direction = legacyDirection;
    next.connected = safeBoolean(input.connected, DEFAULTS.connected);
    next.showCenter = safeBoolean(input.showCenter, DEFAULTS.showCenter);
    next.showOrbit = safeBoolean(input.showOrbit, DEFAULTS.showOrbit);
    next.showPairGuides = safeBoolean(input.showPairGuides, DEFAULTS.showPairGuides);
    next.layout = LAYOUTS.has(input.layout) ? input.layout : DEFAULTS.layout;
    next.flashMode = FLASH_MODES.has(input.flashMode) ? input.flashMode : DEFAULTS.flashMode;
    next.pairMode = PAIR_MODES.has(input.pairMode) ? input.pairMode : DEFAULTS.pairMode;

    const phases = Array.isArray(input.phases) ? input.phases : [];
    next.phases = DEFAULT_PHASES.map((fallback, index) => safePhase(phases[index], fallback));
    const directions = suppliedDirections;
    next.directions = DEFAULT_DIRECTIONS.map((_fallback, index) => safeDirection(directions[index], directions.length ? DEFAULT_DIRECTIONS[index] : legacyDirection));
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

  function activeCircleCount(layout = settings.layout) {
    return layout === "single" ? 1 : layout === "four-corners" ? 4 : 2;
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
      } else if (control.tagName === "SELECT") {
        const settingKey = key === "layoutSelect" ? "layout" : key;
        control.value = String(settings[settingKey]);
      }
    }

    controls.gap.disabled = settings.connected;
    controls.gap.setAttribute("aria-disabled", String(settings.connected));
    const gapNumber = $("gapNumber");
    gapNumber.disabled = settings.connected;
    gapNumber.setAttribute("aria-disabled", String(settings.connected));
    const timedMode = settings.flashMode === "timed";
    controls.frequencyFpm.disabled = !timedMode;
    controls.frequencyFpm.setAttribute("aria-disabled", String(!timedMode));
    readouts.frequencyFpm.disabled = !timedMode;
    readouts.frequencyFpm.setAttribute("aria-disabled", String(!timedMode));

    for (const [key, output] of Object.entries(readouts)) {
      if (!output) continue;
      const value = settings[key];
      if (output.tagName === "INPUT" && output.type === "number") {
        const decimal = ["speedRpm", "movingThickness", "flashThickness", "circleSpacing", "circleScale", "alignmentAngle"].includes(key) ? 1 : 0;
        output.value = formatNumber(value, decimal);
      } else if (key.endsWith("Color")) {
        output.textContent = formatColor(value);
      }
    }

    $("rotationReadout").textContent = `${formatNumber(settings.speedRpm, 1)} rpm`;
    $("cadenceReadout").textContent = timedMode ? `${formatNumber(settings.frequencyFpm)} fpm` : "Once / revolution";
    $("durationReadout").textContent = `${formatNumber(settings.durationMs)} ms`;
    $("motionSummary").textContent = timedMode ? `${formatNumber(settings.speedRpm, 1)} rpm · ${formatNumber(settings.frequencyFpm)} fpm` : `${formatNumber(settings.speedRpm, 1)} rpm · once / revolution`;
    $("geometrySummary").textContent = `${formatNumber(settings.innerRadius)}% inner · ${settings.connected ? "0" : formatNumber(settings.gap)}% gap`;
    $("guidesSummary").textContent = `Center ${settings.showCenter ? "on" : "off"} · Orbit ${settings.showOrbit ? "on" : "off"}`;
    $("alignmentSummary").textContent = `${settings.angularOffset > 0 ? "+" : ""}${formatNumber(settings.angularOffset)}° offset`;
    $("layoutSummary").textContent = `${LAYOUT_LABELS[settings.layout]} · ${activeCircleCount()} circle${activeCircleCount() === 1 ? "" : "s"}`;
    controls.presetSelect.value = lastPreset;

    const activeDirections = settings.directions.slice(0, activeCircleCount());
    const allDirectionsMatch = activeDirections.length > 0 && activeDirections.every((direction) => direction === activeDirections[0]);
    const segmented = document.querySelector(".segmented");
    if (segmented) {
      segmented.classList.toggle("is-mixed", !allDirectionsMatch);
      segmented.setAttribute("aria-label", allDirectionsMatch ? "Set all directions" : "Set all directions; active circles use mixed directions");
    }
    for (const directionButton of document.querySelectorAll(".segmented [data-direction]")) {
      const selected = allDirectionsMatch && directionButton.dataset.direction === activeDirections[0];
      directionButton.classList.toggle("is-selected", selected);
      directionButton.setAttribute("aria-pressed", String(selected));
    }
    for (const directionButton of document.querySelectorAll("[data-circle-direction]")) {
      const index = Number(directionButton.dataset.circleDirection);
      const selected = directionButton.dataset.direction === settings.directions[index];
      directionButton.classList.toggle("is-selected", selected);
      directionButton.setAttribute("aria-pressed", String(selected));
    }

    const rows = document.querySelectorAll(".circle-row");
    const count = activeCircleCount();
    rows.forEach((row, index) => {
      const active = index < count;
      row.classList.toggle("is-inactive", !active);
      row.setAttribute("aria-hidden", String(!active));
      row.querySelectorAll("input, button").forEach((control) => { control.disabled = !active; });
      const phase = row.querySelector(".circle-phase-input");
      if (phase && document.activeElement !== phase) phase.value = formatNumber(settings.phases[index], 1);
    });
  }

  function resetFlashSchedule(now = performance.now()) {
    runtime.nextFlashAt = now + intervalMs();
    runtime.pendingFlash = false;
  }

  function movingAngles() {
    const count = activeCircleCount();
    return settings.phases.slice(0, count).map((phase, index) => {
      const direction = settings.directions[index] === "ccw" ? -1 : 1;
      return runtime.angle * direction + degreesToRadians(phase);
    });
  }

  function captureFlashAngles() {
    return movingAngles().map((angle) => angle + degreesToRadians(settings.angularOffset));
  }

  function applySettings(raw, options = {}) {
    const previousFrequency = settings.frequencyFpm;
    const previousLayout = settings.layout;
    settings = sanitizeSettings(raw);
    if (runtime.referenceFrozen) {
      runtime.flash.angles = captureFlashAngles();
      runtime.flash.angle = runtime.flash.angles[0] || 0;
      runtime.flash.until = Infinity;
      runtime.flash.visible = true;
    } else if (runtime.flash.visible && previousLayout !== settings.layout) {
      runtime.flash.visible = false;
      runtime.flash.angles = [];
    }
    updateControlVisuals();
    if (options.resetSchedule || previousFrequency !== settings.frequencyFpm || !runtime.nextFlashAt) resetFlashSchedule();
    updateStatus();
    draw(performance.now());
  }

  function setCustomPreset() {
    lastPreset = "custom";
    controls.presetSelect.value = "custom";
  }

  function setSettingsFromControl(key, value) {
    applySettings({ ...settings, [key]: value });
    setCustomPreset();
  }

  function getLocalGeometry(radius) {
    const rawInner = radius * (settings.innerRadius / 100);
    const rawMovingLength = radius * (settings.movingLength / 100);
    const rawGap = settings.connected ? 0 : radius * (settings.gap / 100);
    const rawFlashLength = radius * (settings.flashLength / 100);
    const requestedExtent = rawInner + rawMovingLength + rawGap + rawFlashLength;
    // Radial lengths share one scale factor. The margin and half the largest
    // stroke are reserved before scaling, so a 40 px stroke cannot clip the
    // stage edge and no segment is silently truncated.
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
    return {
      inner,
      movingLength,
      flashStart: movingEnd + effectiveGap,
      flashLength,
      requestedExtent,
      availableRadius,
      uniformScale,
      maxStroke,
      radius
    };
  }

  function layoutUnits(layout) {
    switch (layout) {
      case "two-horizontal": return [{ x: -1, y: 0 }, { x: 1, y: 0 }];
      case "two-vertical": return [{ x: 0, y: -1 }, { x: 0, y: 1 }];
      case "two-diagonal-tlbr": return [{ x: -1, y: -1 }, { x: 1, y: 1 }];
      case "two-diagonal-trbl": return [{ x: 1, y: -1 }, { x: -1, y: 1 }];
      case "four-corners": return [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }];
      default: return [{ x: 0, y: 0 }];
    }
  }

  function layoutPairs(layout = settings.layout, pairMode = settings.pairMode) {
    if (layout === "four-corners") return pairMode === "diagonal" ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
    return activeCircleCount(layout) === 2 ? [[0, 1]] : [];
  }

  function getCircleLayout(side = canvasSize.side) {
    const center = side * 0.5;
    // A multi-circle layout treats scale as a percentage of a compact local
    // cell so the default 52% spacing leaves each pivot readable. Single
    // circle mode keeps the original full-stage radius; all radial lengths
    // still receive the same local auto-fit below.
    const localCellFactor = settings.layout === "single" ? 1 : 0.42;
    const baseRadius = center * (settings.circleScale / 100) * localCellFactor;
    const spacing = center * (settings.circleSpacing / 100);
    const units = layoutUnits(settings.layout);
    const positions = units.map((unit) => ({ x: unit.x * spacing, y: unit.y * spacing }));
    const maxAxis = positions.reduce((max, position) => Math.max(max, Math.abs(position.x) + baseRadius, Math.abs(position.y) + baseRadius), baseRadius);
    const margin = Math.min(Math.max(4, center * 0.08), 14, center * 0.35);
    const maxStroke = Math.max(settings.movingThickness, settings.flashThickness);
    const fit = maxAxis > 0 ? Math.min(1, Math.max(0, (center - margin - maxStroke * 0.5) / maxAxis)) : 1;
    const circles = positions.map((position) => {
      const x = center + position.x * fit;
      const y = center + position.y * fit;
      return { x, y, radius: baseRadius * fit, geometry: getLocalGeometry(baseRadius * fit) };
    });
    return { side, center, fit, spacing: spacing * fit, circles, pairs: layoutPairs() };
  }

  function drawSegment(angle, start, length, color, thickness, circle) {
    if (length <= 0) return;
    const x0 = circle.x + Math.cos(angle) * start;
    const y0 = circle.y + Math.sin(angle) * start;
    const x1 = circle.x + Math.cos(angle) * (start + length);
    const y1 = circle.y + Math.sin(angle) * (start + length);
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
    const layout = getCircleLayout(side);
    const angles = movingAngles();

    context.save();
    context.clearRect(0, 0, side, side);
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, side, side);

    if (settings.showPairGuides) {
      context.save();
      context.beginPath();
      for (const [from, to] of layout.pairs) {
        const a = layout.circles[from];
        const b = layout.circles[to];
        if (!a || !b) continue;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.lineWidth = Math.max(1, side * 0.0018);
      context.setLineDash([4, 7]);
      context.strokeStyle = `${settings.centerColor}55`;
      context.stroke();
      context.restore();
    }

    layout.circles.forEach((circle, index) => {
      const geometry = circle.geometry;
      if (settings.showOrbit && geometry.inner > 0) {
        context.save();
        context.beginPath();
        context.arc(circle.x, circle.y, geometry.inner, 0, TWO_PI);
        context.setLineDash([3, 6]);
        context.lineWidth = Math.max(1, side * 0.0012);
        context.strokeStyle = `${settings.centerColor}55`;
        context.stroke();
        context.restore();
      }

      drawSegment(angles[index], geometry.inner, geometry.movingLength, settings.movingColor, Math.min(settings.movingThickness, geometry.maxStroke), circle);
      if (runtime.flash.visible) {
        const flashAngle = runtime.flash.angles[index] ?? (angles[index] + degreesToRadians(settings.angularOffset));
        drawSegment(flashAngle, geometry.flashStart, geometry.flashLength, settings.flashColor, Math.min(settings.flashThickness, geometry.maxStroke), circle);
      }

      if (settings.showCenter) {
        context.save();
        context.beginPath();
        context.arc(circle.x, circle.y, Math.max(2, circle.radius * (settings.centerSize / 100)), 0, TWO_PI);
        context.fillStyle = settings.centerColor;
        context.fill();
        context.restore();
      }
    });
    context.restore();

    $("phaseReadout").textContent = `${formatNumber(signedDegrees(runtime.angle), 1)}°`;
    stageFrame.classList.toggle("is-flashing", runtime.flash.visible);
    if (now) stageFrame.dataset.lastFrame = String(now);
  }

  function triggerFlash(now = performance.now()) {
    // Every active circle is captured in this one call before draw(). The
    // flash angles remain unchanged until expiry, so later RAFs cannot create
    // a stale burst or silently re-align the stationary lines.
    runtime.flash.angles = captureFlashAngles();
    runtime.flash.angle = runtime.flash.angles[0] || 0;
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
      runtime.flash.angles = [];
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
    runtime.flash.angles = captureFlashAngles();
    runtime.flash.angle = runtime.flash.angles[0] || 0;
    runtime.flash.until = Infinity;
    runtime.flash.visible = true;
    updateStatus();
    draw(performance.now());
  }

  function alignAndFreeze() {
    // This explicit command intentionally chooses the requested base angle;
    // automatic alignment flashes below capture the actual crossed frame.
    runtime.angle = degreesToRadians(settings.alignmentAngle);
    runtime.referenceFrozen = true;
    runtime.paused = true;
    runtime.pendingFlash = false;
    runtime.flash.angles = captureFlashAngles();
    runtime.flash.angle = runtime.flash.angles[0] || 0;
    runtime.flash.until = Infinity;
    runtime.flash.visible = true;
    updateStatus();
    draw(performance.now());
  }

  function releaseReference() {
    runtime.referenceFrozen = false;
    runtime.paused = false;
    runtime.flash.visible = false;
    runtime.flash.angles = [];
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
    if (runtime.referenceFrozen) {
      $("stageHint").textContent = Math.abs(settings.angularOffset) < 0.0001 ? "Exact alignment reference" : `Frozen reference · ${offsetText} offset`;
    } else if (settings.flashMode === "alignment") {
      $("stageHint").textContent = "Alignment mode · frame-quantized capture";
    } else {
      $("stageHint").textContent = runtime.paused ? "Press Space to resume" : "Space to pause";
    }
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

  function crossedAlignment(previous, current, target) {
    return Math.floor((current - target) / TWO_PI) > Math.floor((previous - target) / TWO_PI);
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
        runtime.flash.angles = captureFlashAngles();
        runtime.flash.angle = runtime.flash.angles[0] || 0;
        runtime.flash.until = Infinity;
        runtime.flash.visible = true;
      } else {
        runtime.flash.visible = false;
        runtime.flash.angles = [];
      }
    }

    const previousAngle = runtime.angle;
    if (!runtime.paused && !runtime.referenceFrozen) runtime.angle += settings.speedRpm * (TWO_PI / 60000) * safeElapsed;

    if (runtime.pendingFlash && !runtime.flash.visible) {
      triggerFlash(now);
      runtime.pendingFlash = false;
    } else if (!runtime.paused && !runtime.referenceFrozen && !runtime.flash.visible) {
      if (settings.flashMode === "alignment") {
        const target = degreesToRadians(settings.alignmentAngle);
        if (crossedAlignment(previousAngle, runtime.angle, target)) triggerFlash(now);
      } else if (now >= runtime.nextFlashAt) {
        // Rebase after a late frame instead of replaying missed flashes in a
        // burst. This preserves the actual frame that the user sees.
        triggerFlash(now);
        runtime.nextFlashAt = now + intervalMs();
      }
    }

    if (runtime.flash.visible && !runtime.referenceFrozen && now >= runtime.flash.until) {
      runtime.flash.visible = false;
      runtime.flash.angles = [];
    }

    draw(now);
    requestAnimationFrame(animationFrame);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let start = 0; start < bytes.length; start += chunkSize) binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
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
    try { copied = document.execCommand("copy"); } finally { temporary.remove(); }
    return copied;
  }

  async function shareSettings() {
    const url = currentShareUrl();
    window.history.replaceState(null, "", url);
    const copied = await copyText(url).catch(() => false);
    $("shareButtonLabel").textContent = copied ? "Link copied" : "Share URL ready";
    $("shareStatus").textContent = copied ? "Settings copied to the clipboard." : "Settings are encoded in the address bar.";
    window.setTimeout(() => { $("shareButtonLabel").textContent = "Copy share link"; }, 2400);
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

  function commitPhaseInput(target) {
    const index = Number(target.dataset.phaseIndex);
    const value = Number(target.value);
    if (!Number.isFinite(value) || !Number.isInteger(index) || index < 0 || index > 3 || target.value.trim() === "") {
      updateControlVisuals();
      return;
    }
    const phases = [...settings.phases];
    phases[index] = value;
    applySettings({ ...settings, phases });
    setCustomPreset();
  }

  function commitDeferredNumeric(target) {
    if (target.classList.contains("circle-phase-input")) {
      commitPhaseInput(target);
      return;
    }
    const key = target.dataset.numberFor || target.id;
    if (!(key === "alignmentAngle" || key === "angularOffset") || target.value.trim() === "") {
      if (key === "alignmentAngle" || key === "angularOffset") updateControlVisuals();
      return;
    }
    const value = Number(target.value);
    if (!Number.isFinite(value)) {
      updateControlVisuals();
      return;
    }
    setSettingsFromControl(key, value);
  }

  function handleInput(event) {
    const target = event.target;
    if (target.matches(".circle-phase-input") || target.id === "alignmentAngleNumber" || target.id === "angularOffsetNumber") {
      if (event.type === "input") return;
      commitDeferredNumeric(target);
      return;
    }
    const key = target.dataset.numberFor || target.id;
    if (!key || !(key in settings)) return;
    let value;
    if (target.type === "checkbox") value = target.checked;
    else if (target.type === "color") value = target.value;
    else value = Number(target.value);
    if (!Number.isFinite(value) && target.type !== "checkbox" && target.type !== "color") return;
    setSettingsFromControl(key, value);
    if (key === "frequencyFpm") resetFlashSchedule();
  }

  function handleDeferredBlur(event) {
    const target = event.target;
    if (target.matches(".circle-phase-input") || target.id === "alignmentAngleNumber" || target.id === "angularOffsetNumber") commitDeferredNumeric(target);
  }

  function handleCircleDirection(event) {
    const button = event.target.closest("[data-circle-direction]");
    if (!button) return;
    const index = Number(button.dataset.circleDirection);
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    const directions = [...settings.directions];
    directions[index] = safeDirection(button.dataset.direction, directions[index]);
    applySettings({ ...settings, directions, direction: index === 0 ? directions[index] : settings.direction });
    setCustomPreset();
  }

  function handleDirection(event) {
    const button = event.target.closest(".segmented [data-direction]");
    if (!button) return;
    const direction = safeDirection(button.dataset.direction, settings.direction);
    applySettings({ ...settings, direction, directions: settings.directions.map(() => direction) });
    setCustomPreset();
  }

  function applyPhasePattern(phases) {
    applySettings({ ...settings, phases: [...phases] });
    setCustomPreset();
  }

  function phasePatternForLayout(layout, mode = "across") {
    if (layout === "four-corners") return mode === "diagonal" ? [45, 135, 315, 225] : [0, 180, 0, 180];
    if (layout === "two-vertical") return mode === "diagonal" ? [45, 225, 90, 270] : [90, 270, 90, 270];
    if (layout === "two-diagonal-tlbr") return [45, 225, 90, 270];
    if (layout === "two-diagonal-trbl") return [135, 315, 90, 270];
    if (layout === "two-horizontal") return mode === "diagonal" ? [45, 225, 90, 270] : [0, 180, 90, 270];
    return [0, 180, 90, 270];
  }

  function setLayout(layout) {
    const phases = phasePatternForLayout(layout, "across");
    applySettings({ ...settings, layout, pairMode: "across", phases });
    setCustomPreset();
  }

  function setFacePattern(mode) {
    applySettings({ ...settings, pairMode: mode, phases: phasePatternForLayout(settings.layout, mode) });
    setCustomPreset();
  }

  function handleKeydown(event) {
    const target = event.target;
    if (target && (target.matches(".circle-phase-input") || target.id === "alignmentAngleNumber" || target.id === "angularOffsetNumber") && event.key === "Enter") {
      event.preventDefault();
      commitDeferredNumeric(target);
      target.blur();
      return;
    }
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
      runtime.flash.angles = captureFlashAngles();
      runtime.flash.angle = runtime.flash.angles[0] || 0;
      runtime.flash.until = Infinity;
      runtime.flash.visible = true;
    } else {
      runtime.flash.visible = false;
      runtime.flash.angles = [];
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
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stageFrame.requestFullscreen) await stageFrame.requestFullscreen();
    } catch (_error) {
      // Fullscreen can be denied by an embedding context; the stage remains usable.
    }
  }

  function attachListeners() {
    for (const input of document.querySelectorAll("input[type=range], input[type=color], input[type=checkbox], input[type=number]")) {
      input.addEventListener("input", handleInput);
      input.addEventListener("change", handleInput);
      if (input.matches(".circle-phase-input") || input.id === "alignmentAngleNumber" || input.id === "angularOffsetNumber") input.addEventListener("blur", handleDeferredBlur);
    }
    document.querySelector(".segmented").addEventListener("click", handleDirection);
    $("circleRows").addEventListener("click", handleCircleDirection);
    controls.presetSelect.addEventListener("change", () => {
      if (controls.presetSelect.value === "custom") return;
      applyPreset(controls.presetSelect.value);
    });
    controls.layoutSelect.addEventListener("change", () => setLayout(controls.layoutSelect.value));
    controls.flashMode.addEventListener("change", () => setSettingsFromControl("flashMode", controls.flashMode.value));
    $("faceAcrossButton").addEventListener("click", () => setFacePattern("across"));
    $("faceDiagonalButton").addEventListener("click", () => setFacePattern("diagonal"));
    $("alignFreezeButton").addEventListener("click", alignAndFreeze);
    $("pauseButton").addEventListener("click", togglePause);
    $("singleFlashButton").addEventListener("click", requestSingleFlash);
    $("freezeButton").addEventListener("click", () => { if (runtime.referenceFrozen) releaseReference(); else freezeReference(); });
    $("resetButton").addEventListener("click", () => {
      applyPreset("default");
      clearShareConfig();
      $("shareStatus").textContent = "Defaults restored.";
    });
    $("shareButton").addEventListener("click", shareSettings);
    $("fullscreenButton").addEventListener("click", toggleFullscreen);
    $("fullscreenExitButton").addEventListener("click", async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_error) { /* ignored */ }
    });
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("resize", scheduleResize, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(scheduleResize).observe(stageFrame);
    reducedMotionQuery.addEventListener?.("change", (event) => {
      if (event.matches) {
        runtime.paused = true;
        runtime.flash.visible = false;
        runtime.flash.angles = [];
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

  function publicSettings() {
    return cloneSettings(settings);
  }

  function init() {
    readInitialSettings();
    updateControlVisuals();
    attachListeners();
    updateStatus();
    resizeCanvas();
    requestAnimationFrame(animationFrame);

    // This small public surface keeps manual browser QA and focused logic
    // checks possible without coupling the page to a framework.
    window.flashLagDemo = Object.freeze({
      getSettings: publicSettings,
      getGeometry: () => {
        const layout = getCircleLayout(canvasSize.side);
        return layout.circles.length === 1 ? { ...layout.circles[0].geometry, center: layout.circles[0].x } : layout;
      },
      getLayout: () => getCircleLayout(canvasSize.side),
      getMovingAngles: () => [...movingAngles()],
      getRuntime: () => ({ angle: runtime.angle, flashCount: runtime.flashCount, paused: runtime.paused, referenceFrozen: runtime.referenceFrozen }),
      getFlash: () => ({ visible: runtime.flash.visible, angle: runtime.flash.angle, angles: [...runtime.flash.angles], until: runtime.flash.until }),
      setSettings: (raw) => applySettings({ ...settings, ...(raw || {}) }, { resetSchedule: true }),
      tick: (now) => animationFrame(Number(now)),
      singleFlash: requestSingleFlash,
      freeze: freezeReference,
      alignAndFreeze,
      reset: () => applyPreset("default")
    });
  }

  init();
})();
