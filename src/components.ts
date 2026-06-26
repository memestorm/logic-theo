import type { Component, Signal } from "./types";

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  comp: Component;
  inputs: Signal[];
  outputs: Signal[];
  selected: boolean;
}

export interface ComponentDef {
  type: string;
  label: string;
  category: "Inputs" | "Gates" | "Outputs";
  swatch: string;
  defaultProps: Record<string, number>;
  configurableInputs?: boolean; // allow +/- inputs
  size(comp: Component): { w: number; h: number };
  numInputs(comp: Component): number;
  numOutputs(comp: Component): number;
  evaluate(inputs: Signal[], comp: Component): Signal[];
  draw(d: DrawCtx): void;
  onClick?(comp: Component): void; // mouse down on body (e.g. switch / button press)
  onRelease?(comp: Component): void; // mouse up (e.g. button release)
  tick?(comp: Component, dtMs: number): void; // time-based state (clock)
}

const GATE_W = 66;

function gateHeight(n: number): number {
  return Math.max(46, n * 16 + 14);
}

// Even vertical spread of `n` points along a body of height `h`.
export function spread(h: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [h / 2];
  const pad = 12;
  const usable = h - pad * 2;
  return Array.from({ length: n }, (_, i) => pad + (usable * i) / (n - 1));
}

function count1s(inputs: Signal[]): number {
  return inputs.reduce<number>((a, b) => a + b, 0);
}

const COLOR_BODY = "#222c4a";
const COLOR_EDGE = "#3a4570";
const COLOR_TEXT = "#dce4f7";

// Draw a rounded rectangle path.
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const registry: Record<string, ComponentDef> = {};

// ---------- Proper gate shape drawing (ANSI/IEEE style) ----------

type GateShape = "and" | "or" | "xor" | "tri"; // tri = triangle (buffer/not)

function drawGateShape(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  shape: GateShape, negated: boolean, selected: boolean
) {
  const pad = 6;
  const bx = x + pad; // body left
  const bw = w - pad * 2 - (negated ? 8 : 0); // body width (leave room for bubble)
  const by = y;
  const bh = h;
  const cy = y + h / 2; // center y

  ctx.beginPath();
  if (shape === "tri") {
    // Triangle (buffer / NOT)
    ctx.moveTo(bx, by + 2);
    ctx.lineTo(bx + bw, cy);
    ctx.lineTo(bx, by + bh - 2);
    ctx.closePath();
  } else if (shape === "and") {
    // Flat left, rounded right (D-shape)
    const r = bh / 2;
    ctx.moveTo(bx + bw - r, by);
    ctx.arcTo(bx + bw + r * 0.1, by, bx + bw + r * 0.1, cy, r);
    ctx.arcTo(bx + bw + r * 0.1, by + bh, bx + bw - r, by + bh, r);
    ctx.lineTo(bx, by + bh);
    ctx.lineTo(bx, by);
    ctx.closePath();
  } else {
    // OR / XOR curved shape
    const cp = bw * 0.35;
    ctx.moveTo(bx, by);
    // top curve
    ctx.bezierCurveTo(bx + cp, by, bx + bw - cp, by, bx + bw, cy);
    // bottom curve
    ctx.bezierCurveTo(bx + bw - cp, by + bh, bx + cp, by + bh, bx, by + bh);
    // back curve (concave)
    ctx.bezierCurveTo(bx + bw * 0.2, cy + bh * 0.15, bx + bw * 0.2, cy - bh * 0.15, bx, by);
    ctx.closePath();
  }

  ctx.fillStyle = COLOR_BODY;
  ctx.fill();
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.strokeStyle = selected ? "#6ea8ff" : COLOR_EDGE;
  ctx.stroke();

  // XOR extra input curve
  if (shape === "xor") {
    ctx.beginPath();
    const cx2 = bx - 5;
    ctx.moveTo(cx2, by);
    ctx.bezierCurveTo(cx2 + bw * 0.2, cy - bh * 0.15, cx2 + bw * 0.2, cy + bh * 0.15, cx2, by + bh);
    ctx.strokeStyle = selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.stroke();
  }

  // Negation bubble
  if (negated) {
    const bub_x = bx + bw + 4;
    ctx.beginPath();
    ctx.arc(bub_x, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_BODY;
    ctx.fill();
    ctx.strokeStyle = selected ? "#6ea8ff" : "#6b78a8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Small label text inside gate (small, subtle)
  ctx.fillStyle = "#8a9bc060";
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

interface GateSpec {
  type: string;
  label: string;
  shape: GateShape;
  negated: boolean;
  fixed1?: boolean;
  fn: (inputs: Signal[]) => boolean;
}

function defineGate(spec: GateSpec) {
  registry[spec.type] = {
    type: spec.type,
    label: spec.label,
    category: "Gates",
    swatch: spec.label.slice(0, 1),
    defaultProps: spec.fixed1 ? {} : { inputs: 2 },
    configurableInputs: !spec.fixed1,
    size: (c) => ({ w: GATE_W, h: spec.fixed1 ? 46 : gateHeight(c.props.inputs ?? 2) }),
    numInputs: (c) => (spec.fixed1 ? 1 : Math.max(2, Math.round(c.props.inputs ?? 2))),
    numOutputs: () => 1,
    evaluate: (inputs) => {
      const r = spec.fn(inputs);
      return [(spec.negated ? !r : r) ? 1 : 0];
    },
    draw: (d) => {
      const { ctx, comp, selected } = d;
      const { w, h } = registry[comp.type].size(comp);
      drawGateShape(ctx, comp.x, comp.y, w, h, spec.shape, spec.negated, selected);
      // label inside
      ctx.fillStyle = COLOR_TEXT + "80";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.label, comp.x + w / 2 - (spec.negated ? 2 : 0), comp.y + h / 2);
    },
  };
}

defineGate({ type: "and", label: "AND", shape: "and", negated: false, fn: (i) => i.length > 0 && i.every((v) => v === 1) });
defineGate({ type: "or", label: "OR", shape: "or", negated: false, fn: (i) => i.some((v) => v === 1) });
defineGate({ type: "xor", label: "XOR", shape: "xor", negated: false, fn: (i) => count1s(i) % 2 === 1 });
defineGate({ type: "nand", label: "NAND", shape: "and", negated: true, fn: (i) => i.length > 0 && i.every((v) => v === 1) });
defineGate({ type: "nor", label: "NOR", shape: "or", negated: true, fn: (i) => i.some((v) => v === 1) });
defineGate({ type: "xnor", label: "XNOR", shape: "xor", negated: true, fn: (i) => count1s(i) % 2 === 1 });
defineGate({ type: "not", label: "NOT", shape: "tri", negated: true, fixed1: true, fn: (i) => i[0] === 1 });
defineGate({ type: "buffer", label: "BUF", shape: "tri", negated: false, fixed1: true, fn: (i) => i[0] === 1 });

// ---------- Inputs ----------

registry["switch"] = {
  type: "switch",
  label: "Switch",
  category: "Inputs",
  swatch: "S",
  defaultProps: {},
  size: () => ({ w: 56, h: 40 }),
  numInputs: () => 0,
  numOutputs: () => 1,
  evaluate: (_in, c) => [c.state.on ? 1 : 0],
  onClick: (c) => {
    c.state.on = c.state.on ? 0 : 1;
  },
  draw: (d) => {
    const { ctx, comp } = d;
    const on = comp.state.on === 1;
    roundRect(ctx, comp.x, comp.y, 56, 40, 9);
    ctx.fillStyle = COLOR_BODY;
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();
    // track + knob
    roundRect(ctx, comp.x + 8, comp.y + 13, 40, 14, 7);
    ctx.fillStyle = on ? "#2f9e54" : "#3a4570";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(comp.x + (on ? 40 : 16), comp.y + 20, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#e7ecf5";
    ctx.fill();
  },
};

registry["button"] = {
  type: "button",
  label: "Button",
  category: "Inputs",
  swatch: "B",
  defaultProps: {},
  size: () => ({ w: 50, h: 44 }),
  numInputs: () => 0,
  numOutputs: () => 1,
  evaluate: (_in, c) => [c.state.pressed ? 1 : 0],
  onClick: (c) => {
    c.state.pressed = 1;
  },
  onRelease: (c) => {
    c.state.pressed = 0;
  },
  draw: (d) => {
    const { ctx, comp } = d;
    const p = comp.state.pressed === 1;
    roundRect(ctx, comp.x, comp.y, 50, 44, 9);
    ctx.fillStyle = COLOR_BODY;
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(comp.x + 25, comp.y + 22, p ? 11 : 13, 0, Math.PI * 2);
    ctx.fillStyle = p ? "#d65a5a" : "#8a93b8";
    ctx.fill();
  },
};

registry["clock"] = {
  type: "clock",
  label: "Clock",
  category: "Inputs",
  swatch: "C",
  defaultProps: { period: 1000 }, // ms for a full on/off cycle (60 BPM default)
  size: () => ({ w: 72, h: 52 }),
  numInputs: () => 0,
  numOutputs: () => 1,
  evaluate: (_in, c) => [c.state.phase ? 1 : 0],
  tick: (c, dt) => {
    const period = Math.max(50, c.props.period ?? 1000);
    c.state.elapsed = (c.state.elapsed ?? 0) + dt;
    if (c.state.elapsed >= period / 2) {
      c.state.elapsed = 0;
      c.state.phase = c.state.phase ? 0 : 1;
    }
  },
  draw: (d) => {
    const { ctx, comp, selected } = d;
    const w = 72, h = 52;
    roundRect(ctx, comp.x, comp.y, w, h, 9);
    ctx.fillStyle = COLOR_BODY;
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeStyle = selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.stroke();

    const on = comp.state.phase === 1;
    const period = Math.max(50, comp.props.period ?? 1000);
    const bpm = Math.round(60000 / period);

    // BPM display
    ctx.fillStyle = on ? "#5ad17a" : "#e7ecf5";
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${bpm}`, comp.x + w / 2, comp.y + 18);

    // "BPM" label
    ctx.fillStyle = "#7e8bb5";
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.fillText("BPM", comp.x + w / 2, comp.y + 33);

    // blinking indicator dot
    ctx.beginPath();
    ctx.arc(comp.x + w / 2, comp.y + h - 7, 3, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#5ad17a" : "#3a4570";
    ctx.fill();
  },
};

// ---------- Outputs ----------

registry["led"] = {
  type: "led",
  label: "LED",
  category: "Outputs",
  swatch: "•",
  defaultProps: {},
  size: () => ({ w: 40, h: 40 }),
  numInputs: () => 1,
  numOutputs: () => 0,
  evaluate: () => [],
  draw: (d) => {
    const { ctx, comp } = d;
    const on = d.inputs[0] === 1;
    const cx = comp.x + 20;
    const cy = comp.y + 20;
    if (on) {
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22);
      g.addColorStop(0, "#ff6b6b");
      g.addColorStop(1, "#ff6b6b00");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#ff4d4d" : "#5a2230";
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : "#8a93b8";
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();
  },
};

// Segment helpers (thick rounded strokes).
function seg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, on: boolean) {
  ctx.strokeStyle = on ? "#ff3b3b" : "#3a1c24";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

registry["seg7"] = {
  type: "seg7",
  label: "7-Segment",
  category: "Outputs",
  swatch: "8",
  defaultProps: {},
  size: () => ({ w: 56, h: 84 }),
  numInputs: () => 7, // a b c d e f g
  numOutputs: () => 0,
  evaluate: () => [],
  draw: (d) => {
    const { ctx, comp } = d;
    roundRect(ctx, comp.x, comp.y, 56, 84, 9);
    ctx.fillStyle = "#15101a";
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();
    const i = d.inputs;
    const L = comp.x + 16, R = comp.x + 40, CX = comp.x + 28;
    const T = comp.y + 16, M = comp.y + 42, B = comp.y + 68;
    seg(ctx, L + 2, T, R - 2, T, i[0] === 1); // a
    seg(ctx, R, T + 3, R, M - 3, i[1] === 1); // b
    seg(ctx, R, M + 3, R, B - 3, i[2] === 1); // c
    seg(ctx, L + 2, B, R - 2, B, i[3] === 1); // d
    seg(ctx, L, M + 3, L, B - 3, i[4] === 1); // e
    seg(ctx, L, T + 3, L, M - 3, i[5] === 1); // f
    seg(ctx, L + 2, M, R - 2, M, i[6] === 1); // g
    void CX;
  },
};

registry["nixie"] = {
  type: "nixie",
  label: "Nixie (BCD)",
  category: "Outputs",
  swatch: "N",
  defaultProps: {},
  size: () => ({ w: 56, h: 84 }),
  numInputs: () => 4, // BCD: bit0..bit3
  numOutputs: () => 0,
  evaluate: () => [],
  draw: (d) => {
    const { ctx, comp } = d;
    roundRect(ctx, comp.x, comp.y, 56, 84, 9);
    ctx.fillStyle = "#1a1410";
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();
    const i = d.inputs;
    const value = (i[0] === 1 ? 1 : 0) + (i[1] === 1 ? 2 : 0) + (i[2] === 1 ? 4 : 0) + (i[3] === 1 ? 8 : 0);
    const cx = comp.x + 28;
    const cy = comp.y + 44;
    if (value <= 9) {
      ctx.save();
      ctx.shadowColor = "#ff9b3d";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#ffb347";
      ctx.font = "700 46px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(value), cx, cy);
      ctx.restore();
    } else {
      ctx.fillStyle = "#5a4a3a";
      ctx.font = "700 20px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("—", cx, cy);
    }
  },
};

// ---------- 4x4 LED Matrix ----------

const MATRIX_SIZE = 4;
const MATRIX_LED_R = 7;
const MATRIX_GAP = 22;
const MATRIX_PAD = 14;

registry["matrix4x4"] = {
  type: "matrix4x4",
  label: "4×4 LED",
  category: "Outputs",
  swatch: "▦",
  defaultProps: {},
  size: () => {
    const s = MATRIX_PAD * 2 + (MATRIX_SIZE - 1) * MATRIX_GAP;
    return { w: s, h: s };
  },
  numInputs: () => MATRIX_SIZE * MATRIX_SIZE, // 16 inputs, row-major (row0col0, row0col1, ...)
  numOutputs: () => 0,
  evaluate: () => [],
  draw: (d) => {
    const { ctx, comp } = d;
    const s = MATRIX_PAD * 2 + (MATRIX_SIZE - 1) * MATRIX_GAP;
    roundRect(ctx, comp.x, comp.y, s, s, 9);
    ctx.fillStyle = "#0d0d14";
    ctx.fill();
    ctx.strokeStyle = d.selected ? "#6ea8ff" : COLOR_EDGE;
    ctx.lineWidth = d.selected ? 2.5 : 1.5;
    ctx.stroke();

    for (let row = 0; row < MATRIX_SIZE; row++) {
      for (let col = 0; col < MATRIX_SIZE; col++) {
        const idx = row * MATRIX_SIZE + col;
        const on = d.inputs[idx] === 1;
        const cx = comp.x + MATRIX_PAD + col * MATRIX_GAP;
        const cy = comp.y + MATRIX_PAD + row * MATRIX_GAP;

        if (on) {
          const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, MATRIX_LED_R + 4);
          g.addColorStop(0, "#ff6b6b");
          g.addColorStop(1, "#ff6b6b00");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, MATRIX_LED_R + 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, MATRIX_LED_R, 0, Math.PI * 2);
        ctx.fillStyle = on ? "#ff4d4d" : "#2a1520";
        ctx.fill();
      }
    }
  },
};

// ---------- Geometry helpers ----------

import type { Vec2 } from "./types";

export function compSize(comp: Component): { w: number; h: number } {
  return registry[comp.type].size(comp);
}

// World positions of a component's input and output pins.
export function pinPositions(comp: Component): { inputs: Vec2[]; outputs: Vec2[] } {
  const def = registry[comp.type];
  const { w, h } = def.size(comp);
  const ni = def.numInputs(comp);
  const no = def.numOutputs(comp);
  const inputs = spread(h, ni).map((dy) => ({ x: comp.x, y: comp.y + dy }));
  const outputs = spread(h, no).map((dy) => ({ x: comp.x + w, y: comp.y + dy }));
  return { inputs, outputs };
}
