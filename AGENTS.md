# Urban Eclipse: instructions for coding agents

## Start every session here

1. Read `docs/HANDOFF-2026-11-16.md`. It has the current state, what is live, the ordered next
   steps and the setup for a fresh machine. It wins over older notes (the newest
   `docs/HANDOFF-*.md` is always the current one).
2. Check the machine is set up: `node -v` is 22 (`.nvmrc`; Astro refuses Node 20), `npm ci` done,
   `.env` present (keys `PUBLIC_CESIUM_ION_TOKEN`, `PUBLIC_TILESET_URL`; the user keeps it
   outside git). Then `npx vitest run` must show 588 passed, 1 skipped, or more.
3. Tell the user in two or three sentences where things stand and which next step you propose,
   then work.

When you finish a stretch of work, update the handoff (or write a new dated one) so the next
session can start the same way.

## Working rules (from the user)

- **Verify before presenting.** Tests and build, and for anything visual a screenshot of the
  real page that you have looked at. Never hand the user a "run this and tell me" step. If you
  cannot verify something, say so plainly.
- **Commit finished, verified work** in small, coherent commits without asking. Push, deploy
  or open PRs only when the user asks. Deploys are outward-facing: get an explicit OK.
- **This repository is public.** Never commit `.env`, tokens, keys, server IPs or personal data.
- **Positions and heights come from data, never from memory**: OSM (Overpass/Nominatim) for
  coordinates, DGM1 (bare earth) or DOM1 (surface) for heights. Put the independent check in
  the test comment.
- **Honest output.** The product says "never" when geometry says never, and marks uncertainty
  (`needsSiteCheck`, `horizonConfident`) instead of guessing.
- **Output from other agents is unverified** until its diff and tests have been checked
  (a qwen run once shipped tests against APIs that did not exist).
- **UI:** one canonical sun and moon, coloured by `src/lib/mapBodyLook.ts` over
  `src/lib/skyPalette.ts`; no ad-hoc body art per widget. No vertical exaggeration, no
  tilt-shift. Golden hour stays clean gold with contrast, never muddy brown or grey.
- The user writes German or English; panel 05 copy is German, `/plan/` is English.

## How to check things

- Unit tests: `npx vitest run`. Typecheck: bare `tsc` shows hundreds of environmental JSX
  errors, so use `npx tsc --noEmit -p . --jsx react-jsx` and compare touched files before/after.
- Pages: `npm run build && npx astro preview`, then Playwright. Cesium on `/classic` starves
  Playwright's actionability waits: click through `page.evaluate`, remove the canvases, capture
  with CDP `Page.captureScreenshot`, and read the PNG. `/plan/` never fires `load` locally
  (the city geometry is only on the server); wait for `domcontentloaded`.
- Tile pipeline: b3dm tiles must carry `NORMAL` or the clay render goes flat; pass `--force`
  to `scripts/convert_batch.py` whenever the pipeline code changes.

## Map of the code

- `src/lib/`: pure, Node-testable maths: `vantageWindows.ts` (alignment calendar of a fixed
  standing point), `vantages.ts` (standing points), `landmarks.ts` (solids of revolution),
  `horizonWindows.ts` (terrain-gated windows, flag `PUBLIC_HORIZON_WINDOWS`), `areaSolver.ts`,
  `silhouette.ts`, `heightmap.ts`.
- `src/components/react/`: the `/classic` planner (Cesium); `VantageCalendar.tsx` is panel 05.
- `src/miniature/`: the `/plan/` Three.js planner; read `src/miniature/README.md`.
- `scripts/`: Python data tools (`.venv`, `scripts/requirements.txt`) and Node helpers.
- `specs/001-telephoto-los-planner/`: the original spec and research.
