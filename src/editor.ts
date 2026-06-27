import type { Component, PinRef, Signal, Vec2, Wire } from "./types";
import { Circuit, newId, type SimResult } from "./simulation";
import { registry, pinPositions, compSize } from "./components";

const GRID = 8;
const PIN_R = 5;

// Rainbow ribbon cable colours — 16 distinct hues that cycle for dense pin sets.
const RIBBON_COLORS = [
  "#e6194b", // red
  "#f58231", // orange
  "#ffe119", // yellow
  "#3cb44b", // green
  "#42d4f4", // cyan
  "#4363d8", // blue
  "#911eb4", // purple
  "#f032e6", // magenta
  "#e6194b", // red (repeat cycle for 8+)
  "#fabebe", // pink
  "#9a6324", // brown
  "#aaffc3", // mint
  "#808000", // olive
  "#000075", // navy
  "#469990", // teal
  "#dcbeff", // lavender
];

interface Camera {
  x: number;
  y: number;
  scale: number;
}

type Mode = "idle" | "drag" | "pan" | "wire";

export class Editor {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  circuit: Circuit;
  camera: Camera = { x: 60, y: 60, scale: 1 };
  dpr = Math.max(1, window.devicePixelRatio || 1);
  cssW = 0;
  cssH = 0;

  mode: Mode = "idle";
  selectedComp: string | null = null;
  selectedWire: string | null = null;

  // drag bookkeeping
  private dragOffset: Vec2 = { x: 0, y: 0 };
  private downScreen: Vec2 = { x: 0, y: 0 };
  private moved = false;
  private pressedComp: string | null = null;

  // wiring bookkeeping
  private wireFrom: PinRef | null = null;
  private mouseWorld: Vec2 = { x: 0, y: 0 };
  private hoverPin: PinRef | null = null;

  // multi-touch bookkeeping (Pointer Events)
  private pointers = new Map<number, Vec2>();
  private pinch: { dist: number; scale: number; worldX: number; worldY: number } | null = null;

  private sim: SimResult = { inputs: new Map(), outputs: new Map() };
  private lastTime = performance.now();
  onChange: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, circuit: Circuit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.circuit = circuit;
    this.bindEvents();
    this.resize();
    requestAnimationFrame(this.frame);
  }

  // ----- coordinate transforms (CSS pixels <-> world) -----
  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: (sx - this.camera.x) / this.camera.scale, y: (sy - this.camera.y) / this.camera.scale };
  }

  resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  };

  // ----- public API -----
  addComponentAt(type: string, wx: number, wy: number) {
    const def = registry[type];
    if (!def) return;
    const tmp: Component = { id: "tmp", type, x: 0, y: 0, props: { ...def.defaultProps }, state: {} };
    const { w, h } = compSize(tmp);
    const c: Component = {
      id: newId(type),
      type,
      x: snap(wx - w / 2),
      y: snap(wy - h / 2),
      props: { ...def.defaultProps },
      state: {},
    };
    this.circuit.addComponent(c);
    this.selectComp(c.id);
    this.onChange();
  }

  private selectComp(id: string | null) {
    this.selectedComp = id;
    this.selectedWire = null;
  }

  deleteSelected() {
    if (this.selectedWire) {
      this.circuit.removeWire(this.selectedWire);
      this.selectedWire = null;
      this.onChange();
    } else if (this.selectedComp) {
      this.circuit.removeComponent(this.selectedComp);
      this.selectedComp = null;
      this.onChange();
    }
  }

  // Adjust the input count of the selected gate (if it supports it).
  adjustInputs(delta: number) {
    if (!this.selectedComp) return;
    const c = this.circuit.getComp(this.selectedComp);
    if (!c || !registry[c.type].configurableInputs) return;
    const cur = c.props.inputs ?? 2;
    const next = Math.max(2, Math.min(8, Math.round(cur + delta)));
    if (next !== cur) {
      c.props.inputs = next;
      // drop wires pointing at pins that no longer exist
      this.circuit.wires = this.circuit.wires.filter((w) => !(w.toComp === c.id && w.toPin >= next));
      this.onChange();
    }
  }

  // Adjust clock speed by a BPM delta (e.g. +10, -10).
  adjustClock(bpmDelta: number) {
    if (!this.selectedComp) return;
    const c = this.circuit.getComp(this.selectedComp);
    if (!c || c.type !== "clock") return;
    const currentPeriod = c.props.period ?? 1000;
    const currentBpm = 60000 / currentPeriod;
    const newBpm = Math.max(10, Math.min(600, Math.round(currentBpm + bpmDelta)));
    c.props.period = Math.round(60000 / newBpm);
    this.onChange();
  }

  getClockBpm(): number | null {
    if (!this.selectedComp) return null;
    const c = this.circuit.getComp(this.selectedComp);
    if (!c || c.type !== "clock") return null;
    return Math.round(60000 / (c.props.period ?? 1000));
  }

  selectedInfo(): { type: string; configurableInputs: boolean; isClock: boolean } | null {
    if (!this.selectedComp) return null;
    const c = this.circuit.getComp(this.selectedComp);
    if (!c) return null;
    return {
      type: c.type,
      configurableInputs: !!registry[c.type].configurableInputs,
      isClock: c.type === "clock",
    };
  }

  // ----- event wiring -----
  private panLast: Vec2 = { x: 0, y: 0 };

  private bindEvents() {
    window.addEventListener("resize", this.resize);
    this.canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (document.activeElement === document.body) {
          this.deleteSelected();
          e.preventDefault();
        }
      }
    });
    // palette drag-and-drop
    this.canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    this.canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = e.dataTransfer?.getData("text/plain");
      if (!type) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.addComponentAt(type, w.x, w.y);
    });
  }

  private localPos(e: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private beginPinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    this.pinch = {
      dist: dist || 1,
      scale: this.camera.scale,
      worldX: (mid.x - this.camera.x) / this.camera.scale,
      worldY: (mid.y - this.camera.y) / this.camera.scale,
    };
  }

  private updatePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || !this.pinch) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const ns = Math.min(3, Math.max(0.3, (this.pinch.scale * dist) / this.pinch.dist));
    this.camera.scale = ns;
    this.camera.x = mid.x - this.pinch.worldX * ns;
    this.camera.y = mid.y - this.pinch.worldY * ns;
  }

  private onDown = (e: PointerEvent) => {
    const s = this.localPos(e);
    this.pointers.set(e.pointerId, s);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released or synthetic — safe to ignore */
    }

    // Second finger down -> start pinch-zoom, abort any single-pointer action.
    if (this.pointers.size === 2) {
      this.mode = "idle";
      this.wireFrom = null;
      this.hoverPin = null;
      this.pressedComp = null;
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    const world = this.screenToWorld(s.x, s.y);
    this.downScreen = s;
    this.panLast = s;
    this.moved = false;

    const pin = this.hitPin(world);
    if (pin) {
      this.wireFrom = pin;
      this.mode = "wire";
      this.mouseWorld = world;
      return;
    }

    const comp = this.hitComp(world);
    if (comp) {
      this.selectComp(comp.id);
      this.mode = "drag";
      this.dragOffset = { x: world.x - comp.x, y: world.y - comp.y };
      const def = registry[comp.type];
      if (def.onRelease) {
        def.onClick?.(comp);
        this.pressedComp = comp.id;
      }
      return;
    }

    const wid = this.hitWire(world);
    if (wid) {
      this.selectedWire = wid;
      this.selectedComp = null;
      this.mode = "idle";
      return;
    }

    this.selectComp(null);
    this.mode = "pan";
  };

  private onMove = (e: PointerEvent) => {
    const s = this.localPos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    const world = this.screenToWorld(s.x, s.y);
    this.mouseWorld = world;
    if (Math.hypot(s.x - this.downScreen.x, s.y - this.downScreen.y) > 4) this.moved = true;

    if (this.mode === "wire") {
      this.hoverPin = this.hitPin(world);
      return;
    }
    if (this.mode === "drag" && this.selectedComp) {
      const c = this.circuit.getComp(this.selectedComp);
      if (c) {
        c.x = snap(world.x - this.dragOffset.x);
        c.y = snap(world.y - this.dragOffset.y);
      }
      return;
    }
    if (this.mode === "pan") {
      this.camera.x += s.x - this.panLast.x;
      this.camera.y += s.y - this.panLast.y;
      this.panLast = s;
      return;
    }
    this.hoverPin = this.hitPin(world);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    // If fingers remain, don't finalize a single-pointer gesture.
    if (this.pointers.size >= 1) {
      this.mode = "idle";
      this.wireFrom = null;
      this.hoverPin = null;
      return;
    }

    if (this.mode === "wire" && this.wireFrom) {
      const target = this.hitPin(this.mouseWorld);
      if (target) this.tryConnect(this.wireFrom, target);
      this.wireFrom = null;
      this.hoverPin = null;
    }
    if (this.pressedComp) {
      const c = this.circuit.getComp(this.pressedComp);
      if (c) registry[c.type].onRelease?.(c);
      this.pressedComp = null;
    } else if (this.mode === "drag" && !this.moved && this.selectedComp) {
      const c = this.circuit.getComp(this.selectedComp);
      if (c) {
        const def = registry[c.type];
        if (def.onClick && !def.onRelease) def.onClick(c);
      }
    }
    if (this.mode === "drag" && this.moved) this.onChange();
    this.mode = "idle";
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const s = this.localPos(e);
    const before = this.screenToWorld(s.x, s.y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.scale = Math.min(3, Math.max(0.3, this.camera.scale * factor));
    this.camera.x = s.x - before.x * this.camera.scale;
    this.camera.y = s.y - before.y * this.camera.scale;
  };

  private tryConnect(a: PinRef, b: PinRef) {
    let out: PinRef | null = null;
    let inp: PinRef | null = null;
    if (a.kind === "out" && b.kind === "in") {
      out = a;
      inp = b;
    } else if (a.kind === "in" && b.kind === "out") {
      out = b;
      inp = a;
    }
    if (!out || !inp || out.comp === inp.comp) return;
    const wire: Wire = {
      id: newId("w"),
      fromComp: out.comp,
      fromPin: out.pin,
      toComp: inp.comp,
      toPin: inp.pin,
    };
    this.circuit.addWire(wire);
    this.onChange();
  }

  // ----- hit testing (world space) -----
  private hitPin(world: Vec2): PinRef | null {
    const r = (PIN_R + 5) / this.camera.scale;
    for (let i = this.circuit.components.length - 1; i >= 0; i--) {
      const c = this.circuit.components[i];
      const { inputs, outputs } = pinPositions(c);
      for (let p = 0; p < outputs.length; p++) {
        if (Math.hypot(world.x - outputs[p].x, world.y - outputs[p].y) < r)
          return { comp: c.id, pin: p, kind: "out" };
      }
      for (let p = 0; p < inputs.length; p++) {
        if (Math.hypot(world.x - inputs[p].x, world.y - inputs[p].y) < r)
          return { comp: c.id, pin: p, kind: "in" };
      }
    }
    return null;
  }

  private hitComp(world: Vec2): Component | null {
    for (let i = this.circuit.components.length - 1; i >= 0; i--) {
      const c = this.circuit.components[i];
      const { w, h } = compSize(c);
      if (world.x >= c.x && world.x <= c.x + w && world.y >= c.y && world.y <= c.y + h) return c;
    }
    return null;
  }

  private hitWire(world: Vec2): string | null {
    const thr = 6 / this.camera.scale;
    for (let i = this.circuit.wires.length - 1; i >= 0; i--) {
      const w = this.circuit.wires[i];
      const from = this.circuit.getComp(w.fromComp);
      const to = this.circuit.getComp(w.toComp);
      if (!from || !to) continue;
      const a = pinPositions(from).outputs[w.fromPin];
      const b = pinPositions(to).inputs[w.toPin];
      if (a && b && distToSegment(world, a, b) < thr) return w.id;
    }
    return null;
  }

  // ----- render loop -----
  private frame = () => {
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;
    this.circuit.tick(dt);
    this.sim = this.circuit.simulate();
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#0f1320";
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.scale, this.camera.scale);

    this.drawGrid();
    this.drawWires();
    for (const c of this.circuit.components) this.drawComponent(c);
    this.drawRubberBand();

    ctx.restore();
  }

  private drawGrid() {
    const ctx = this.ctx;
    const step = 32;
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.cssW, this.cssH);
    ctx.fillStyle = "#1b2238";
    const startX = Math.floor(tl.x / step) * step;
    const startY = Math.floor(tl.y / step) * step;
    for (let x = startX; x < br.x; x += step) {
      for (let y = startY; y < br.y; y += step) {
        ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }
  }

  private drawWires() {
    const ctx = this.ctx;
    for (const w of this.circuit.wires) {
      const from = this.circuit.getComp(w.fromComp);
      const to = this.circuit.getComp(w.toComp);
      if (!from || !to) continue;
      const a = pinPositions(from).outputs[w.fromPin];
      const b = pinPositions(to).inputs[w.toPin];
      if (!a || !b) continue;

      let color: string;
      if (this.selectedWire === w.id) {
        color = "#ffffff";
      } else {
        // Rainbow colour based on the target (input) pin index.
        color = RIBBON_COLORS[w.toPin % RIBBON_COLORS.length];
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = this.selectedWire === w.id ? 3.5 : 2.5;
      const dx = Math.max(24, Math.abs(b.x - a.x) * 0.4);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
      ctx.stroke();
    }
  }

  private drawComponent(c: Component) {
    const ctx = this.ctx;
    const def = registry[c.type];
    def.draw({
      ctx,
      comp: c,
      inputs: this.sim.inputs.get(c.id) ?? [],
      outputs: this.sim.outputs.get(c.id) ?? [],
      selected: this.selectedComp === c.id,
    });
    // pins
    const { inputs, outputs } = pinPositions(c);
    const ins = this.sim.inputs.get(c.id) ?? [];
    const outs = this.sim.outputs.get(c.id) ?? [];
    inputs.forEach((p, i) => this.drawPin(p, ins[i], c.id, i, "in"));
    outputs.forEach((p, i) => this.drawPin(p, outs[i], c.id, i, "out"));
  }

  // Build a set of "compId:pin:kind" keys for connected pins — reserved for future use.
  // private connectedPins(): Set<string> { ... }

  // For connected input pins, return the ribbon colour index.
  private pinRibbonColor(comp: string, pin: number, kind: "in" | "out"): string | null {
    if (kind === "in") {
      // Check if this input pin is connected; colour by pin index.
      for (const w of this.circuit.wires) {
        if (w.toComp === comp && w.toPin === pin) {
          return RIBBON_COLORS[pin % RIBBON_COLORS.length];
        }
      }
    } else {
      // Output pins: if connected, find what input pin(s) it drives; use the first wire's target pin.
      for (const w of this.circuit.wires) {
        if (w.fromComp === comp && w.fromPin === pin) {
          return RIBBON_COLORS[w.toPin % RIBBON_COLORS.length];
        }
      }
    }
    return null;
  }

  private drawPin(p: Vec2, v: Signal | undefined, comp: string, pin: number, kind: "in" | "out") {
    const ctx = this.ctx;
    const hovered = this.hoverPin && this.hoverPin.comp === comp && this.hoverPin.pin === pin && this.hoverPin.kind === kind;
    if (hovered) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PIN_R + 3, 0, Math.PI * 2);
      ctx.fillStyle = "#6ea8ff55";
      ctx.fill();
    }

    const ribbonColor = this.pinRibbonColor(comp, pin, kind);
    const connected = ribbonColor !== null;

    ctx.beginPath();
    ctx.arc(p.x, p.y, PIN_R, 0, Math.PI * 2);
    if (connected) {
      // Connected pins show their ribbon colour.
      ctx.fillStyle = ribbonColor!;
    } else {
      // Unconnected pins are dim/hollow.
      ctx.fillStyle = "#1e2640";
    }
    ctx.fill();
    ctx.strokeStyle = connected ? ribbonColor! : "#46506f";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // High signal indicator: bright inner dot.
    if (v === 1) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }

  private drawRubberBand() {
    if (this.mode !== "wire" || !this.wireFrom) return;
    const ctx = this.ctx;
    const from = this.circuit.getComp(this.wireFrom.comp);
    if (!from) return;
    const pp = pinPositions(from);
    const a = this.wireFrom.kind === "out" ? pp.outputs[this.wireFrom.pin] : pp.inputs[this.wireFrom.pin];
    if (!a) return;
    ctx.strokeStyle = "#9fb4e8";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(this.mouseWorld.x, this.mouseWorld.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
