# Urbaneclipse / Plaster Void — session handoff

Date: 2026-07-31
Previous session ended waiting for a manual Coolify deploy of `origin/main @ 7b376e8`.

## Status

- **Git**: `origin/main` @ `7b376e8` — local and remote in sync.
- **Coolify app**: Plaster Void (`hmmohdjag54egc4o01qqwnbn`)
  - URL: `https://plastervoid.167.235.138.184.sslip.io`
  - Live commit: `7b376e82aa02a104899f32c26e9f4c4c085edb81` ✅
  - Container: `hmmohdjag54egc4o01qqwnbn-155514107471` Up + healthy
- **Live bundle**: `_astro/CesiumViewer.jDRS89qY.js` (was `BRdh1iQg`)
  - Contains `horizonFog` ✅
  - Contains `"Framing the shot"` ✅
- **Tiles**: `/berlin-full/` volume mount still present; no tile-side changes needed.
- **Tests**: `npm test` — 356 passed, 1 skipped ✅

## What was done

Triggered a Coolify deploy via the local API (`POST /api/v1/deploy?uuid=...`) from the Hetzner host over Tailscale. A temporary deploy-scoped API token was created, used, and deleted.

## Result

The clay-render, terrain grounding, occlusion fixes, loader, and horizon-seam fixes are now live.
