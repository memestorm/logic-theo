import "./style.css";
import { Circuit } from "./simulation";
import { registry } from "./components";
import { Editor } from "./editor";
import { autosave, downloadCircuit, loadAutosave, openCircuitFile } from "./storage";

const circuit = new Circuit();
const saved = loadAutosave();
if (saved) circuit.load(saved);

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const editor = new Editor(canvas, circuit);

// Autosave (throttled) whenever the circuit changes structurally.
let saveTimer = 0;
editor.onChange = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => autosave(circuit.toData()), 300);
  refreshToolbar();
};

// ---------- palette ----------
const palette = document.getElementById("palette")!;
const categories: Array<ComponentCategory> = ["Inputs", "Gates", "Outputs"];
type ComponentCategory = "Inputs" | "Gates" | "Outputs";

for (const cat of categories) {
  const h = document.createElement("h3");
  h.textContent = cat;
  palette.appendChild(h);
  for (const def of Object.values(registry)) {
    if (def.category !== cat) continue;
    const item = document.createElement("div");
    item.className = "palette-item";
    item.draggable = true;
    item.innerHTML = `<span class="swatch">${def.swatch}</span><span>${def.label}</span>`;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", def.type);
    });
    // Click also drops it into the middle of the view (handy on trackpads).
    item.addEventListener("dblclick", () => {
      const w = editor.screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
      editor.addComponentAt(def.type, w.x, w.y);
    });
    palette.appendChild(item);
  }
}

// ---------- toolbar ----------
const toolbar = document.getElementById("toolbar")!;
toolbar.innerHTML = `
  <span class="title">Logic Lab</span>
  <button class="btn" id="btn-save">Save</button>
  <button class="btn" id="btn-open">Open</button>
  <button class="btn" id="btn-clear">Clear</button>
  <span class="spacer"></span>
  <span id="ctx-tools"></span>
`;

document.getElementById("btn-save")!.addEventListener("click", () => {
  const name = prompt("Save circuit as:", "my-circuit") || "my-circuit";
  downloadCircuit(circuit.toData(), name);
});
document.getElementById("btn-open")!.addEventListener("click", async () => {
  const data = await openCircuitFile();
  if (data) {
    circuit.load(data);
    autosave(circuit.toData());
  }
});
document.getElementById("btn-clear")!.addEventListener("click", () => {
  if (confirm("Clear the whole circuit?")) {
    circuit.components = [];
    circuit.wires = [];
    editor.onChange();
  }
});

// Context-sensitive tools (input count, clock speed) for the selected item.
const ctxTools = document.getElementById("ctx-tools")!;
function refreshToolbar() {
  const info = editor.selectedInfo();
  ctxTools.innerHTML = "";
  if (!info) return;
  if (info.configurableInputs) {
    addBtn("− input", () => editor.adjustInputs(-1));
    addBtn("+ input", () => editor.adjustInputs(1));
  }
  if (info.isClock) {
    addBtn("−10", () => editor.adjustClock(-10));
    addBtn("−1", () => editor.adjustClock(-1));
    addBtn("+1", () => editor.adjustClock(1));
    addBtn("+10", () => editor.adjustClock(10));
    const bpm = editor.getClockBpm();
    if (bpm !== null) {
      const label = document.createElement("span");
      label.className = "btn";
      label.style.cursor = "default";
      label.style.opacity = "0.7";
      label.textContent = `${bpm} BPM`;
      ctxTools.appendChild(label);
    }
  }
}
function addBtn(label: string, fn: () => void) {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = label;
  b.addEventListener("click", fn);
  ctxTools.appendChild(b);
}

// Keyboard shortcuts for input count.
window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") editor.adjustInputs(1);
  if (e.key === "-" || e.key === "_") editor.adjustInputs(-1);
});

// Refresh toolbar after any click (selection may have changed).
canvas.addEventListener("mouseup", () => setTimeout(refreshToolbar, 0));

// ---------- hint ----------
document.getElementById("hint")!.textContent =
  "Drag parts from the left • drag pin-to-pin to wire • click a switch to toggle • scroll to zoom • Delete removes selected";

// Debug handle (handy for testing in the console).
(window as unknown as { lab: unknown }).lab = { circuit, editor, registry };
