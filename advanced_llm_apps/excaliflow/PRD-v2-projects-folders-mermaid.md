# PRD — Excaliflow v2: Projects, Canvas Organization, Selection Export & Mermaid Import

**Owner:** Devanshu Shah · **Status:** Approved for build · **Target:** excaliflow-cloud.vercel.app
** builds on:** v1 cloud backend (Supabase `diagrams` table + Vercel `/api/*`, shipped 2026-10-19)

---

## 1. Problem statement

Excaliflow v1 can save a whole workspace to the cloud, but there is no *organization*:
canvases (tabs) live in a flat tab bar, cloud saves are an undifferentiated list in a
header dropdown, exporting is scattered across the top nav (Export PNG button + a ⋯
menu), and there is no way to (a) group related canvases under a named project,
(b) rename or manage a canvas from a single organized place, (c) download one canvas
or just the selected shapes, or (d) bootstrap a diagram from text (Mermaid).

## 2. Goals

1. A **Projects** system modeled on Claude Projects / Claude Code: a project groups
   many canvases; all projects and their canvases are browsable from the sidebar.
2. Full canvas lifecycle from the sidebar: **open, rename, add, duplicate, delete**.
3. **Per-canvas downloads** from a kebab (⋯) menu in multiple formats.
4. **Selection export**: right-click selected shapes → download just those, as PNG/JSON.
5. **Declutter the top nav**: export actions move out of the header into the sidebar.
6. **Mermaid import**: paste or upload Mermaid flowchart code → a new canvas is
   generated automatically, with flow animation ON by default.
7. Zero new backend services: reuse the deployed Supabase table and Vercel API.

## 3. Non-goals (v2)

- Nested folders inside projects, tags, search, sharing/multi-user auth.
- Mermaid sequence/class/ER diagrams (flowcharts only); Mermaid styling directives
  (`classDef`, `style`, `linkStyle`) are parsed-and-ignored.
- SVG export (the render engine is canvas-based; no SVG serializer exists).
- Real-time collaboration.

## 4. Key concept — data model (no schema change)

| Concept | Maps to | Notes |
| --- | --- | --- |
| **Project** | one row in `diagrams` (`id`, `name`, `data`, timestamps) | `data` is the existing serialized workspace JSON |
| **Canvas** | one entry in `data.tabs[]` | the app already models canvases as tabs with `id`, `name`, `elements[]` |
| **Open workspace** | the tabs currently loaded in the app | auto-saved to `localStorage` by the app (existing) |
| **Linked project** | the cloud project the open workspace was opened from / saved to | tracked client-side (`localStorage: excaliflow.currentProjectId`) |

Because a project *is* a workspace document, **no Supabase migration is required**;
all v2 features are served by the existing endpoints (`GET/POST /api/diagrams`,
`GET/PATCH/DELETE /api/diagrams/:id`). Canvas lists for non-open projects are
lazy-loaded (`GET /api/diagrams/:id`) when a project is expanded in the tree.

## 5. Functional requirements

### F1 — Sidebar modes & icon rail
- A vertical icon rail appears at the far left (44px), with two modes:
  **✎ Tools** (the existing properties inspector) and **📁 Projects** (new panel).
- Clicking an icon switches the left panel content; the panel collapse control
  (⌘\) keeps working. Default mode on load: Tools (unchanged v1 behavior).
- The rail mirrors the muse.ai pattern the user asked for: one icon per panel.

### F2 — Projects panel
Sections, top to bottom:
1. **Header**: "Projects" + `＋ New Project` button + `⇩ Import Mermaid` button (F7).
2. **Cloud status**: connection state (● Connected / ○ Password needed) + 🔑 password action.
   The cloud password is asked once per session (existing v1 behavior).
3. **Current workspace card**: linked project name (or "Untitled workspace"),
   save state (`Saved ✓` / `● Unsaved changes`), **Save** and **Save as New** buttons,
   and the **canvas list of the open workspace** (F3).
4. **All projects tree**: every cloud project (newest first), expandable to reveal
   its canvases (read-only preview for non-open projects).

### F3 — Canvas management (open workspace)
For each canvas row in the Current card:
- **Click** → switch to that canvas.
- **Double-click name / kebab → Rename** → inline rename (Enter commits, Esc cancels;
  trims whitespace; empty name rejected; max 48 chars — matches the app's tab limit).
- **Kebab (⋯) menu**: Open · Rename · Duplicate · Download PNG (2x) · Download JSON ·
  Copy PNG *(active canvas only, it is a live-canvas op)* · Record Video *(active only)* ·
  Delete (with confirm; the last remaining canvas cannot be deleted).
- **＋ Add canvas** button at the end of the list (creates a blank canvas).
- The app's existing bottom tab dock stays as-is; both stay in sync (same state).

### F4 — Project operations
Project kebab (⋯): **Open** · **Rename** (prompt; trims; empty rejected) ·
**Add canvas** (opens project, then adds) · **Download project JSON** ·
**Delete project** (confirm; deleting the currently open project unlinks the
workspace, which remains open locally).
- **New Project**: prompts for a name, creates a fresh one-canvas workspace,
  saves it to the cloud, and opens it.
- **Open project safety**: opening a project never loses work —
  if the current workspace is linked and dirty it is auto-saved first;
  if it is unlinked and non-empty, the user is asked to save it as a project first
  (or explicitly discard). Local `localStorage` auto-save remains the safety net.

### F5 — Save model & dirty state
- Dirty = current serialized workspace ≠ last cloud-saved snapshot of the linked project.
- The dirty indicator updates when the panel opens, after every panel operation,
  and on a 5s poll while the panel is visible.
- **Save** writes the whole workspace to the linked project (`PATCH`);
  **Save as New** creates a new project (`POST`) and links to it.

### F6 — Selection export (right-click)
- Right-clicking the canvas opens a custom context menu (the app has none today).
  Right-clicking an unselected shape selects it first (Excalidraw convention).
  Right-drag panning is not a feature of this app, so no gesture conflicts.
- Menu (with a selection): **Download selection as PNG (2x)** · **Copy selection as PNG** ·
  **Download selection as JSON**. With no selection (empty canvas area):
  **Download canvas as PNG** · **Download canvas as JSON**.
- Selection PNG renders *only* the included elements, cropped to their bounds.
  Inclusion rule: selected elements, plus any arrow whose *both* bound shapes are
  selected (so connected flows export coherently). Selection JSON uses the app's
  single-scene format (`{type:'excaliflow', elements:[…]}`), re-importable via
  the app's existing loader.

### F7 — Mermaid import
- Entry points: Projects panel button (F2) and the panel's empty state.
- Modal: textarea (paste code), file picker (`.mmd`, `.txt`, `.md`), direction is
  read from the code, **Generate canvas** / Cancel. Parse errors are listed in the
  modal and block generation (no silent partial imports) — warnings (skipped
  directives) do not block.
- Supported syntax (flowcharts): `graph`/`flowchart` + `TD|TB|BT|LR|RL`;
  node shapes `[rect]`, `(rounded→rect)`, `{diamond}`, `((circle→ellipse))`,
  `([stadium→rect])`, `[[subroutine→rect]]`, `>flag→rect]`, bare ids;
  edges `-->`, `---`, `-.->`, `==>`, `--x`, `--o`, `<-->`; labels via
  `-->|label|`, `-- label -->`, `---|label|`; chained edges (`A --> B --> C`);
  fan-out with `&`; comments (`%%`); subgraphs are flattened (contents imported,
  grouping ignored — warning shown).
- Layout: layered (longest-path layering from sources; cycle-safe via DFS
  back-edge detection), nodes centered per layer, direction-aware axes.
  Back/loop edges get a curve offset so they render as arcs.
- Output: a **new canvas tab** named after the diagram (title comment or
  "Mermaid Diagram"), elements built with the app's own `createElement`
  (hand-drawn style, auto-fit text), edge labels as text elements at edge
  midpoints, **flow animation ON** for the new canvas regardless of global default.
- Node colors cycle the app's semantic palette by layer for readability.

### F8 — Top-nav declutter
- Remove from the header: **Export PNG** button and the **⋯ export dropdown**
  (Copy PNG, Record Video, Save Scene, Load Scene, Clear Canvas).
- All of those actions remain available: export/download actions move to canvas
  kebabs + context menu (F3/F6); *Load Scene* becomes "Import .excaliflow file"
  in the Projects panel; *Clear Canvas* stays reachable via the canvas kebab of
  the active canvas ("Clear canvas" item, with confirm).
- The ☁️ Cloud header button from v1 is also removed; its save/load list is
  superseded by the Projects panel (same backend, better organization).
  `cloud.js` is refactored into a pure API client (`window.ExcaliflowCloud`).

## 6. Technical design

| File | Change |
| --- | --- |
| `index.html` | Remove header export block; add 3 `<script>` tags. No other edits. |
| `cloud.js` | **Refactor**: strip UI injection; expose `ExcaliflowCloud` API client (call, password mgmt). |
| `projects.js` | **New**: rail + panel modes, projects tree, CRUD, kebab menus, downloads (PNG via `renderScenePasses` with `opts.elements`, JSON builders), save/dirty logic, panel CSS injection via `projects.css`. |
| `projects.css` | **New**: rail/panel/tree/kebab/modal styles, reusing app CSS vars. |
| `mermaid-import.js` | **New**: pure parser + layout (Node-testable, `module.exports` guard) + modal UI + canvas creation via app globals. |
| `selection-export.js` | **New**: right-click capture, context menu, subset PNG/JSON export. |
| `api/*`, `supabase/schema.sql` | **Unchanged** — existing backend already serves every v2 operation. |

Integration surface (all pre-existing app globals): `window.state`,
`createElement`, `createCanvasTab`, `switchCanvasTab`, `renameCanvasTab`,
`duplicateCanvasTab`, `closeCanvasTab`, `serializeWorkspace`,
`restoreWorkspaceData`, `renderScenePasses`, `getArrowGeometry`,
`downloadBlob`, `showToast`, `angleToSide`, `hitTestElement`, `screenToWorld`.

## 7. Edge cases (all must be handled)

- Rename: empty/whitespace name, >48 chars, duplicate names (allowed, like files),
  rename of the active canvas (tab dock must reflect it — the app re-renders tabs).
- Delete: last canvas of a project (blocked), active canvas (switch to neighbor first),
  project deletion while open, delete while a save is in flight.
- Save: no password set (401 prompt flow), network failure (toast + stays dirty),
  payload >10 MB (API 413 surfaced as a clear message), saving an empty workspace.
- Open: dirty linked workspace (auto-save first), unlinked non-empty workspace
  (save-or-discard prompt), project with 0 canvases in data (defensive: treat as 1 blank),
  corrupted project JSON (error toast, workspace untouched).
- Downloads: canvas with 0 elements (PNG falls back to a blank 800×500 export,
  matching the app's own bounds behavior), huge canvas (cap scale at 2x),
  names with characters illegal in filenames (slugified).
- Selection: right-click with multi-selection, right-click on empty area,
  selection containing arrows bound to unselected shapes (excluded unless both
  endpoints selected), freedraw/text elements in selection, menu position at
  viewport edges (clamped), Esc/outside-click dismissal.
- Mermaid: empty input, no direction line, invalid lines (error list with line numbers),
  duplicate node definitions (last wins, warning), self-loops, cycles, disconnected
  components, >200 nodes (warn, still import), labels with quotes/brackets/unicode,
  CRLF input, `&` fan-outs, subgraph blocks, edge label on every edge type.
- Panel: 0 projects (empty state with CTA), 100 projects (list scrolls),
  project names with HTML (rendered as text, never HTML — XSS-safe).

## 8. Testing plan

- **Node unit tests** for the Mermaid parser + layout (30+ cases incl. every
  edge case in §7 that is parser-visible) and for pure helpers (slugify,
  single-canvas payload builder, selection inclusion rule).
- **API regression**: re-run the v1 handler unit tests + dev-server e2e
  (backend is unchanged, this guards against accidental breakage).
- **Static checks**: `node --check` on all JS; DOM id-wiring audit for new UI.
- **Live verification** on the deployed URL (public, browser-reachable):
  panel renders, project create/open/rename, canvas rename, kebab PNG+JSON
  downloads, Mermaid import of a sample flowchart renders with animation,
  right-click selection export menu appears.

## 9. Rollout

1. Commit all changes to the fork (`devanshushah30/awesome-llm-apps`, main).
2. Vercel auto-deploys from GitHub (no config change; no new env vars).
3. Supabase: **no changes required**.
4. Verify live per §8; report.

## 10. Future scope

Nested folders & drag-to-organize · project search · tags · SVG export ·
per-canvas cloud rows (split `diagrams` into `projects` + `canvases` tables) ·
Mermaid subgraphs as frames · multi-user auth via Supabase Auth.
