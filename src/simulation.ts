import type { Component, Signal, Wire, CircuitData } from "./types";
import { registry } from "./components";

export interface SimResult {
  inputs: Map<string, Signal[]>;
  outputs: Map<string, Signal[]>;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export class Circuit {
  components: Component[] = [];
  wires: Wire[] = [];

  getComp(id: string): Component | undefined {
    return this.components.find((c) => c.id === id);
  }

  addComponent(c: Component) {
    this.components.push(c);
  }

  removeComponent(id: string) {
    this.components = this.components.filter((c) => c.id !== id);
    this.wires = this.wires.filter((w) => w.fromComp !== id && w.toComp !== id);
  }

  addWire(w: Wire) {
    // One driver per input pin: drop any existing wire into the same input.
    this.wires = this.wires.filter((x) => !(x.toComp === w.toComp && x.toPin === w.toPin));
    this.wires.push(w);
  }

  removeWire(id: string) {
    this.wires = this.wires.filter((w) => w.id !== id);
  }

  toData(): CircuitData {
    return { version: 1, components: this.components, wires: this.wires };
  }

  load(data: CircuitData) {
    this.components = data.components ?? [];
    this.wires = data.wires ?? [];
  }

  // Advance time-based components (clocks) by dt milliseconds.
  tick(dtMs: number) {
    for (const c of this.components) {
      registry[c.type].tick?.(c, dtMs);
    }
  }

  // Settle the network: repeatedly evaluate until signals stop changing.
  simulate(): SimResult {
    const outputs = new Map<string, Signal[]>();
    for (const c of this.components) {
      outputs.set(c.id, new Array(registry[c.type].numOutputs(c)).fill(0) as Signal[]);
    }

    // Map each input pin -> its driving output pin.
    const driver = new Map<string, { comp: string; pin: number }>();
    for (const w of this.wires) {
      driver.set(`${w.toComp}:${w.toPin}`, { comp: w.fromComp, pin: w.fromPin });
    }

    const inputs = new Map<string, Signal[]>();
    const maxIter = Math.min(2000, this.components.length * 2 + 10);

    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (const c of this.components) {
        const def = registry[c.type];
        const ni = def.numInputs(c);
        const ins: Signal[] = [];
        for (let p = 0; p < ni; p++) {
          const src = driver.get(`${c.id}:${p}`);
          if (src) {
            ins.push((outputs.get(src.comp)?.[src.pin] ?? 0) as Signal);
          } else {
            ins.push(0);
          }
        }
        inputs.set(c.id, ins);
        const outs = def.evaluate(ins, c);
        const prev = outputs.get(c.id)!;
        if (outs.length !== prev.length || outs.some((v, k) => v !== prev[k])) {
          outputs.set(c.id, outs);
          changed = true;
        }
      }
      if (!changed) break;
    }

    return { inputs, outputs };
  }
}
