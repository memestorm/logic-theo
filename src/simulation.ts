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
    // Allow multiple wires into one input pin (wired-OR). Only block exact
    // duplicates of the same source->target connection.
    const duplicate = this.wires.some(
      (x) => x.fromComp === w.fromComp && x.fromPin === w.fromPin && x.toComp === w.toComp && x.toPin === w.toPin
    );
    if (duplicate) return;
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

    // Map each input pin -> all driving output pins (multiple allowed = wired-OR).
    const drivers = new Map<string, Array<{ comp: string; pin: number }>>();
    for (const w of this.wires) {
      const key = `${w.toComp}:${w.toPin}`;
      const list = drivers.get(key);
      if (list) list.push({ comp: w.fromComp, pin: w.fromPin });
      else drivers.set(key, [{ comp: w.fromComp, pin: w.fromPin }]);
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
          const srcs = drivers.get(`${c.id}:${p}`);
          // Wired-OR: the pin is high if any connected source is high.
          let v: Signal = 0;
          if (srcs) {
            for (const s of srcs) {
              if ((outputs.get(s.comp)?.[s.pin] ?? 0) === 1) {
                v = 1;
                break;
              }
            }
          }
          ins.push(v);
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
