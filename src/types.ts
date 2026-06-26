// Core data model for the logic simulator.

// A signal is a simple boolean for now (low/high).
export type Signal = 0 | 1;

export interface Vec2 {
  x: number;
  y: number;
}

// A placed component instance on the canvas.
export interface Component {
  id: string;
  type: string; // key into the component registry
  x: number;
  y: number;
  // Arbitrary per-instance settings, e.g. number of inputs, clock interval.
  props: Record<string, number>;
  // Runtime state owned by the component (switch on/off, clock phase, etc.).
  state: Record<string, number>;
}

// A wire connects one output pin to one input pin.
export interface Wire {
  id: string;
  fromComp: string;
  fromPin: number; // output pin index on source
  toComp: string;
  toPin: number; // input pin index on target
}

export interface CircuitData {
  version: 1;
  components: Component[];
  wires: Wire[];
}

// Identifies a specific pin on a specific component.
export interface PinRef {
  comp: string;
  pin: number;
  kind: "in" | "out";
}
