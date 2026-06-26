import type { CircuitData } from "./types";

const AUTOSAVE_KEY = "logic-lab.autosave";

export function downloadCircuit(data: CircuitData, name = "circuit") {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.logic`;
  a.click();
  URL.revokeObjectURL(url);
}

export function openCircuitFile(): Promise<CircuitData | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".logic,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)) as CircuitData);
        } catch {
          alert("That file could not be read as a circuit.");
          resolve(null);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

export function autosave(data: CircuitData) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function loadAutosave(): CircuitData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as CircuitData) : null;
  } catch {
    return null;
  }
}
