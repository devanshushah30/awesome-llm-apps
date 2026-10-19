# ✏️ Excaliflow

> 🚀 **Deployed by [Devanshu Shah](https://github.com/devanshushah30)** — maintained and hosted in this fork. Original project by Shubham Saboo.

**Hand-drawn diagrams with live animated flows.** Sketch out AI agents, RAG pipelines, or system architectures just like in Excalidraw, and watch data flow through your arrows in real time. Connect shapes, customize colors and sketch styles, and export a crisp 2x PNG or a 60fps video loop. Runs in a single HTML file with zero dependencies.

## Features

- **Hand-drawn look and feel.** Draw boxes, circles, decision diamonds, freehand sketches, and sticky notes using Excalidraw's hand-drawn fonts (`Excalifont`, `Virgil`, `Cascadia`) and sketch fills.
- **Live animated arrows.** Connect any two shapes and watch comets, pulses, neon streaks, or dashed streams travel along your arrows in order from start to finish.
- **Easy arrow editing.** Drag any arrow endpoint around the edge of a shape, pull the middle of an arrow to curve it, or double-click an arrow to straighten it.
- **Fast diagram building.** Press `Tab` or click a `+` port on any selected shape to add and connect the next step automatically, or drop a shape onto an existing arrow to split it in two.
- **Multi-canvas tabs & auto-save.** Work across multiple canvas tabs in the bottom tab dock or top-left canvas switcher—create new tabs (`+ New` / `+ Canvas`), fork/duplicate a diagram (`⧉`) to compare architectures side-by-side, step between tabs (`‹` / `›`), double-click to rename, and have every tab auto-saved to your browser.
- **Ready-made starter templates.** Load built-in diagrams for **AI Agent Swarm**, **RAG Pipeline**, **How Browsers Work**, and **Microservices** in one click.
- **Light & dark canvas + instant export.** Switch between a clean white canvas and a pitch-black neon canvas, then export a cropped 2x PNG, copy to clipboard, record a `.webm` video loop, or save and load `.excaliflow` / `.excalidraw` JSON files.

## How to Get Started

Requires **Node.js 18+** (or open `index.html` directly in any modern browser). Excaliflow has no external npm dependencies, so no install step is needed.

```sh
git clone https://github.com/Shubhamsaboo/awesome-llm-apps.git
cd awesome-llm-apps/advanced_llm_apps/excaliflow
npm start
```

Open **http://localhost:3000** in your browser.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` or `1` | Select, move, resize shapes, or bend arrows |
| `H` or `Space + Drag` | Pan around the canvas |
| `R` or `2` | Rectangle |
| `D` or `3` | Diamond / Decision |
| `O` or `4` | Circle / Ellipse |
| `A` or `5` | Animated Arrow |
| `P` or `7` | Freehand Pen |
| `T` or `8` | Text |
| `N` or `9` | Sticky Note |
| `K` | Laser Pointer |
| `E` or `0` | Eraser |
| `Q` | Keep selected tool active (Tool Lock) |
| `Tab` | Add and connect the next shape |
| `Double-click` | Add a node on empty canvas, edit text, or straighten an arrow |
| `Alt / Option + Drag` | Duplicate selection while dragging |
| `⌥T` (`Alt + T`) | Create a new blank canvas tab |
| `⌥[` / `⌥]` (`Alt + [` / `]`) | Step to previous / next canvas tab |
| `⌥1` – `⌥9` (`Alt + 1..9`) | Switch directly to canvas tab 1–9 |
| `⌘Z` / `⇧⌘Z` | Undo / Redo |
| `⌘D` | Duplicate selection |
| `⌘\` | Show or hide the left style panel |

## Project Structure

```text
excaliflow/
|-- index.html            Complete single-file app (UI, sketch renderer, and animation loop)
|-- server.js             Zero-dependency local static server (http://localhost:3000)
|-- verify.js             Automated test suite for geometry, arrows, and interactions
|-- package.json          Start and test scripts
`-- README.md
```

## Development

Run the automated verification checks:

```sh
npm test
```

Licensed under the repository's [Apache-2.0 license](../../LICENSE).

## ☁️ Cloud Backend (Supabase + Vercel)

This fork adds an optional cloud backend so diagrams survive across devices: save named diagrams to Supabase, load them back, overwrite a cloud copy with the current canvas, download any cloud copy as `.excaliflow.json`, or delete it. The header gains a **☁️ Cloud** button (injected by `cloud.js`).

**Architecture**

```text
Browser (index.html + cloud.js)
   │  fetch /api/*  (+ x-cloud-password header)
   ▼
Serverless API (api/, zero dependencies) — Vercel in prod, dev-server.js locally
   │  Supabase REST with service_role key (server-side only, never in the browser)
   ▼
Supabase Postgres → public.diagrams (id, name, data jsonb, timestamps)
```

The frontend never holds a Supabase key. The API is gated by `CLOUD_PASSWORD` (prompted once per browser session, kept in `sessionStorage`).

**1. Create the Supabase project** (free tier is plenty)

1. Go to [supabase.com](https://supabase.com) → New project.
2. SQL Editor → paste `supabase/schema.sql` → Run. (RLS is enabled with no public policies — access is service-role only via the API.)
3. Project Settings → API → copy the **Project URL** and the **service_role** key.

**2. Configure**

```sh
cp .env.example .env   # then fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUD_PASSWORD
```

**3. Run locally** (static files + `/api/*` on one port)

```sh
npm run dev   # → http://localhost:3000
```

(`npm start` still serves the static-only version via `server.js`.)

**4. Deploy to Vercel**

1. Import the repo `devanshushah30/awesome-llm-apps` in Vercel.
2. Set **Root Directory** to `advanced_llm_apps/excaliflow`. No build command, no framework preset — it's static + serverless functions.
3. Add Environment Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUD_PASSWORD`.
4. Deploy. The app is live at `https://<project>.vercel.app`; check `/api/health` returns `{"ok":true}`.

**API reference**

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | no | Liveness probe |
| GET | `/api/diagrams` | password | List saves (newest first) |
| POST | `/api/diagrams` | password | Save `{ name, data }` |
| GET | `/api/diagrams/:id` | password | Fetch one diagram with data |
| PATCH | `/api/diagrams/:id` | password | Update `{ name?, data? }` |
| DELETE | `/api/diagrams/:id` | password | Delete a diagram |

Auth = `x-cloud-password` header matching `CLOUD_PASSWORD`. Diagrams are capped at 10 MB each.
