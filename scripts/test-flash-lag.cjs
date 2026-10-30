const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "flash-lag", "script.js");
const source = fs.readFileSync(sourcePath, "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) { if (force === undefined ? !this.values.delete(name) : force) this.values.add(name); else this.values.delete(name); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = "", type = "") {
    this.id = id;
    this.type = type;
    this.tagName = type ? "INPUT" : "DIV";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = new FakeClassList();
    this.listeners = {};
    this.children = [];
    this.textContent = "";
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  setAttribute(name, value) { this[name] = String(value); }
  querySelector(selector) {
    if (selector === ".circle-phase-input") return this.children.find((child) => child.classList.contains("circle-phase-input")) || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === "input, button") return this.children;
    return [];
  }
  getBoundingClientRect() { return { width: 600, height: 600 }; }
  matches(selector) {
    if (selector === ".circle-phase-input") return this.classList.contains("circle-phase-input");
    if (selector === "input, select, textarea, button") return ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(this.tagName);
    return false;
  }
  closest(selector) { return this.matches(selector) ? this : null; }
}

function makeCanvas() {
  const canvas = new FakeElement("stimulusCanvas");
  canvas.tagName = "CANVAS";
  canvas.getContext = () => ({
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, stroke() {}, fill() {}, setLineDash() {}, setTransform() {}
  });
  return canvas;
}

function makeEnvironment() {
  const elements = new Map();
  const add = (element) => { elements.set(element.id, element); return element; };
  add(makeCanvas());
  const inputIds = [
    "movingColor", "flashColor", "backgroundColor", "centerColor", "movingLength", "flashLength", "gap",
    "movingThickness", "flashThickness", "innerRadius", "centerSize", "speedRpm", "frequencyFpm", "durationMs",
    "angularOffset", "circleSpacing", "circleScale", "alignmentAngle", "connected", "showCenter", "showOrbit", "showPairGuides"
  ];
  for (const id of inputIds) add(new FakeElement(id, id.includes("Color") ? "color" : id === "connected" || id === "showCenter" || id === "showOrbit" || id === "showPairGuides" ? "checkbox" : "range"));
  for (const id of ["movingColorValue", "flashColorValue", "backgroundColorValue", "centerColorValue"]) add(new FakeElement(id));
  for (const id of ["movingLengthNumber", "flashLengthNumber", "gapNumber", "movingThicknessNumber", "flashThicknessNumber", "innerRadiusNumber", "centerSizeNumber", "speedRpmNumber", "frequencyFpmNumber", "durationMsNumber", "angularOffsetNumber", "circleSpacingNumber", "circleScaleNumber", "alignmentAngleNumber"]) {
    const input = add(new FakeElement(id, "number"));
    input.tagName = "INPUT";
    input.dataset.numberFor = id.replace(/Number$/, "");
  }
  const selectIds = ["presetSelect", "layoutSelect", "flashMode"];
  for (const id of selectIds) { const select = add(new FakeElement(id)); select.tagName = "SELECT"; }
  for (const id of ["stageFrame", "statusPill", "statusText", "phaseReadout", "rotationReadout", "cadenceReadout", "durationReadout", "motionSummary", "geometrySummary", "guidesSummary", "alignmentSummary", "layoutSummary", "pauseButtonLabel", "pauseButtonIcon", "freezeButtonLabel", "stageHint", "shareButtonLabel", "shareStatus", "fullscreenButton", "fullscreenExitButton", "faceAcrossButton", "faceDiagonalButton", "alignFreezeButton", "pauseButton", "singleFlashButton", "freezeButton", "resetButton", "shareButton"]) add(new FakeElement(id));
  elements.get("fullscreenButton").querySelector = () => ({ textContent: "" });
  const segmented = new FakeElement("segmented"); segmented.classList.add("segmented");
  const globalDirectionButtons = ["cw", "ccw"].map((direction) => { const b = new FakeElement(); b.tagName = "BUTTON"; b.dataset.direction = direction; return b; });
  segmented.children = globalDirectionButtons;
  const circleRows = add(new FakeElement("circleRows"));
  const circleDirectionButtons = [];
  const rows = [];
  for (let index = 0; index < 4; index += 1) {
    const row = new FakeElement(`circleRow${index}`); row.classList.add("circle-row");
    const phase = new FakeElement(`circlePhase${index}`, "number"); phase.tagName = "INPUT"; phase.classList.add("circle-phase-input"); phase.dataset.phaseIndex = String(index);
    const cw = new FakeElement(); cw.tagName = "BUTTON"; cw.dataset.circleDirection = String(index); cw.dataset.direction = "cw";
    const ccw = new FakeElement(); ccw.tagName = "BUTTON"; ccw.dataset.circleDirection = String(index); ccw.dataset.direction = "ccw";
    row.children = [phase, cw, ccw]; circleRows.children.push(row); rows.push(row); circleDirectionButtons.push(cw, ccw);
  }
  const document = {
    hidden: false,
    fullscreenElement: null,
    body: { appendChild() {} },
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => selector === ".segmented" ? segmented : null,
    querySelectorAll: (selector) => {
      if (selector.includes("input[type=range]")) return [...elements.values()].filter((element) => element.type === "range" || element.type === "color" || element.type === "checkbox" || element.type === "number");
      if (selector === ".segmented [data-direction]") return globalDirectionButtons;
      if (selector === "[data-circle-direction]") return circleDirectionButtons;
      if (selector === ".circle-row") return rows;
      return [];
    },
    addEventListener() {},
    createElement: () => new FakeElement(),
    execCommand: () => false
  };
  const stageFrame = elements.get("stageFrame");
  stageFrame.getBoundingClientRect = () => ({ width: 600, height: 600 });
  const window = {
    devicePixelRatio: 1,
    isSecureContext: false,
    location: { href: "https://example.test/flash-lag/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    setTimeout,
    history: { replaceState() {} }
  };
  const raf = () => 0;
  window.requestAnimationFrame = raf;
  const performance = { now: () => 0 };
  const context = { window, document, performance, requestAnimationFrame: raf, cancelAnimationFrame: () => {}, btoa, atob, TextEncoder, TextDecoder, URL, URLSearchParams, setTimeout, console };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return context.window.flashLagDemo;
}

function nearlyEqual(a, b, epsilon = 1e-10) { return Math.abs(a - b) <= epsilon; }

const demo = makeEnvironment();
assert.deepEqual(Array.from(demo.getSettings().phases), [0, 180, 90, 270], "default phases remain available for old single-circle URLs");
assert.equal(demo.getSettings().layout, "single");

demo.setSettings({ layout: "four-corners", speedRpm: 0, durationMs: 100, angularOffset: 0, phases: [0, 180, 0, 180] });
demo.singleFlash();
demo.tick(1000);
const first = demo.getFlash();
const movingAtCapture = demo.getMovingAngles();
assert.equal(first.visible, true, "one flash activates the shared event");
assert.equal(first.angles.length, 4, "one shared event captures all active circles");
first.angles.forEach((angle, index) => assert.ok(nearlyEqual(angle, movingAtCapture[index]), `circle ${index} flash is captured at its moving angle`));
demo.tick(1050);
assert.deepEqual(Array.from(demo.getFlash().angles), Array.from(first.angles), "stationary flash angles do not drift during the visible interval");
demo.tick(1101);
assert.equal(demo.getFlash().visible, false, "flash expires on its requested timer while paused state is unchanged");

demo.setSettings({ flashMode: "alignment", speedRpm: 60, alignmentAngle: 10, durationMs: 100 });
demo.tick(1200);
const aligned = demo.getFlash();
assert.equal(aligned.visible, true, "alignment mode triggers after crossing the requested angle");
assert.equal(aligned.angles.length, 4, "alignment mode still captures all circles together");
assert.ok(Math.abs(aligned.angles[0] - (10 * Math.PI / 180)) > 1e-3, "alignment mode keeps the actual crossed frame instead of correcting to the target");

demo.setSettings({ layout: "four-corners", circleSpacing: 70, circleScale: 100, movingThickness: 40, flashThickness: 40, movingLength: 82, flashLength: 55, gap: 24, connected: false });
const layout = demo.getLayout();
assert.equal(layout.circles.length, 4, "four-corner layout has four contained circles");
for (const circle of layout.circles) {
  const extent = circle.geometry.flashStart + circle.geometry.flashLength + circle.geometry.maxStroke / 2;
  assert.ok(circle.x - extent >= -1e-8 && circle.x + extent <= layout.side + 1e-8, "horizontal geometry remains inside stage");
  assert.ok(circle.y - extent >= -1e-8 && circle.y + extent <= layout.side + 1e-8, "vertical geometry remains inside stage");
}

demo.setSettings({ layout: "invalid", flashMode: "invalid", phases: [999, -999, "bad", 15], directions: ["ccw", "bad"], circleSpacing: 999, circleScale: -5, alignmentAngle: 999 });
const safe = demo.getSettings();
assert.equal(safe.layout, "single");
assert.equal(safe.flashMode, "timed");
assert.deepEqual(Array.from(safe.phases), [360, -360, 90, 15]);
assert.deepEqual(Array.from(safe.directions), ["ccw", "cw", "cw", "cw"]);
assert.equal(safe.circleSpacing, 70);
assert.equal(safe.circleScale, 20);
assert.equal(safe.alignmentAngle, 180);

console.log("multi-circle logic checks passed");
