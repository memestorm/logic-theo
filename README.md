# Logic Lab

A browser-based digital logic circuit simulator with drag-and-drop components,
live simulation, and a colourful, kid-friendly interface.

**Live:** https://logic.theo.drane.org

## What it does

Build digital circuits by dragging components onto a canvas and wiring them
together pin-to-pin. The simulation runs live — signals propagate, wires and
displays light up in real time.

### Components

- **Inputs:** toggle switch, push button, and a **clock** with an adjustable
  BPM (beats per minute) display and controller
- **Gates:** AND, OR, NOT, XOR, NAND, NOR, XNOR, BUFFER — the multi-input gates
  support 2–8 inputs, drawn with proper ANSI/IEEE symbols
- **Outputs:** LED, 7-segment display, BCD-driven nixie tube, and a **4×4 LED
  matrix**

### Features

- Drag parts from the palette onto the canvas
- Drag pin-to-pin to wire components together
- **Rainbow ribbon-cable wiring** — wires are colour-coded by target pin index,
  making dense components like the LED matrix easy to follow. Connected pins
  glow in their wire colour; unconnected pins stay dim.
- Live signal propagation with colour feedback
- Pan (drag empty space) and zoom (scroll)
- Save circuits to `.logic` files and re-open them later
- Automatic save to the browser, so work survives a refresh
- Unlimited components — no artificial caps

## Controls

| Action | How |
| --- | --- |
| Add a component | Drag it from the palette, or double-click a palette item |
| Wire two components | Drag from one pin to another |
| Toggle a switch | Click it |
| Move a component | Drag its body |
| Delete | Select it and press `Delete` / `Backspace` |
| Change gate inputs | Select a gate, use the `+`/`−` buttons or keys |
| Change clock speed | Select a clock, use the BPM buttons |
| Pan / zoom | Drag empty space / scroll |

## Development

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check and build static files into dist/
```

Built with TypeScript and the HTML5 Canvas — no UI framework. Bundled with Vite.

## Project structure

```
src/
  types.ts        core data model (components, wires, signals)
  components.ts   component registry: shapes, pins, behaviour, drawing
  simulation.ts   the circuit model and the settle-based simulator
  editor.ts       canvas rendering, drag/drop, wiring, pan/zoom
  storage.ts      save/load to file and browser autosave
  main.ts         palette, toolbar, and app wiring
```

## Deployment

Hosted on Cloudflare Pages. Pushing to the `main` branch triggers an automatic
build and deploy.

To deploy manually:

```bash
npm run build
npx wrangler pages deploy dist --project-name logic-lab --branch main
```
