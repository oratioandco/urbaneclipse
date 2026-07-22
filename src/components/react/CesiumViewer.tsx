/**
 * CesiumViewer — the plaster-void scene island.
 *
 * Mounted `client:only="react"` from src/pages/index.astro. Astro NEVER runs this on
 * the server, so the `cesium` import stays out of the SSR module graph (Constitution
 * Principle I/IV; enforced by tests/unit/ssr-graph-guard.test.ts).
 *
 * The scene renders the SELF-HOSTED local 3D Tiles tileset served at
 * `/berlin/tileset.json` (copied into public/berlin). It needs NO Cesium Ion
 * token: the plaster void omits World Terrain and base imagery, so no Ion asset is
 * requested. The PUBLIC_CESIUM_ION_TOKEN env var is read defensively and applied only
 * if present — it never crashes when absent.
 *
 * Integration points:
 *   - Plaster post-process: viewer.scene.postProcessStages.add(createStudioEnvironmentStage)
 *     after the viewer is built (US2). depthTestAgainstTerrain stays TRUE so the
 *     shader's depth texture actually separates geometry from the void.
 *   - US1 occlusion: after tileset readiness, observer=OBSERVER_DEFAULT and
 *     target=TARGET_DEFAULT drive computeOcclusion, whose result drives both the
 *     store (commitOcclusion) and the observer→target polyline colour. Height-store
 *     listeners recompute on slider change; dateTime is intentionally NOT wired
 *     to occlusion (occlusion is time-independent — see src/store.ts).
 *   - US3 time-scrub: a dateTime.listen updates viewer.clock.currentTime so Cesium's
 *     built-in sun position + shadows follow the suncalc-authored time (Strategy B:
 *     drive the native clock; do NOT recompute occlusion on time changes).
 *   - US6 camera: a cameraProfile.listen recomputes viewer.camera.frustum.fov via
 *     fovToCesium(computeHorizontalFov(sensor, focal*zoom), aspectRatio). Cesium 1.143
 *     PerspectiveFrustum.fov is documented as: horizontal FOV when width >= height,
 *     otherwise vertical. fovToCesium already returns hfov unchanged for aspect>=1
 *     (the landscape scene case), so we pass its result straight through.
 */
import { useEffect, useRef, useState } from 'react';
import type * as CesiumType from 'cesium';
// Cesium is served as a UMD GLOBAL (window.Cesium) by vite-plugin-cesium + the
// /cesium/Cesium.js tag injected in index.astro. We use the global at runtime — NOT
// `import * as Cesium from 'cesium'` — so Vite never loads the npm cesium ESM in dev
// (which breaks on Cesium's CommonJS deps: mersenne-twister default-export error / 504).
// `import type` is fully erased at build, so this introduces no runtime dependency.
const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

import { createStudioEnvironmentStage } from '../../cesium/shaders/studioEnvironment.js';
import {
  computeOcclusion,
  drawLineOfSight,
  type LatLonHeight,
  type OcclusionState,
} from '../../cesium/lineOfSight.js';
import {
  dateTime,
  observerHeight,
  targetHeight,
  commitOcclusion,
  cameraProfile,
} from '../../store.js';
import { OBSERVER_DEFAULT, TARGET_DEFAULT } from '../../lib/berlin.js';
import { computeHorizontalFov, fovToCesium } from '../../lib/cameraMath.js';
import ControlPanel, { type ScenePhase } from './ControlPanel.js';
import HourTimeline from './HourTimeline.js';
import SolverSearch from './SolverSearch.js';
import CameraControls from './CameraControls.js';

// The DEPLOYED app serves the committed core subset (public/berlin-core/, the
// Lichtenberger-Brücke -> Fernsehturm sightline). For the full 236-tile scene locally,
// set PUBLIC_TILESET_URL=/berlin/tileset.json in .env (the full tileset is gitignored).
const TILESET_URL = import.meta.env.PUBLIC_TILESET_URL ?? '/berlin-core/tileset.json';

// Tileset root transform translation (ECEF), from data/test_tile/tileset.json.
// Used as a fallback camera target if the tileset's bounding sphere isn't populated yet.
// (Berlin tileset's root bounding-volume centre is in the same neighbourhood; this is
// only consulted before the root content loads.)
const TILESET_ECEF_CENTER = new Cesium.Cartesian3(3782802.4642903516, 902286.4677665455, 5038573.502874194);

/** How long the scene may stay in a non-ready phase before we warn the user (T059). */
const SLOW_SCENE_WARNING_MS = 25_000;

export default function CesiumViewer(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  // --- T059 (FR-013): the island is the only place that knows whether the building
  // data actually arrived, so it owns the scene phase and hands it to the panels.
  // 'connecting' -> 'streaming' -> 'ready', or 'error' if the tileset never loads.
  // NOTE: these are plain React state, NOT store atoms — the store contract
  // (contracts/store.md) is fixed and must not grow a new atom for this.
  const [scenePhase, setScenePhase] = useState<ScenePhase>('connecting');
  const [sceneError, setSceneError] = useState<string | undefined>(undefined);
  const [sceneSlow, setSceneSlow] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Guard against a stale/duplicate mount: never construct two Viewers on one node.
    if (viewerRef.current !== null) return;

    // --- Ion token (OPTIONAL) --------------------------------------------------
    // The plaster void uses no Ion assets; set the token only if provided so that
    // any future Ion-backed feature works without crashing the no-token case.
    const ionToken = import.meta.env.PUBLIC_CESIUM_ION_TOKEN;
    if (typeof ionToken === 'string' && ionToken.length > 0) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }

    // --- Viewer: every UI widget off, no default base imagery ------------------
    const viewer = new Cesium.Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      // Cesium >=1.107: `baseLayer` replaces the deprecated `imageryProvider`.
      // `false` adds NO default imagery layer -> no Ion Bing request -> no token needed.
      baseLayer: false,
    });
    viewerRef.current = viewer;
    // Track disposal so the async tileset callback can no-op after StrictMode unmount.
    let disposed = false;

    // --- T059 scene-phase plumbing ---------------------------------------------
    // `phase` mirrors the React state inside the effect closure so the slow-scene
    // timer can read the CURRENT phase without re-subscribing or re-running the effect.
    let phase: ScenePhase = 'connecting';
    const setPhase = (next: ScenePhase, message?: string): void => {
      if (disposed) return;
      phase = next;
      setScenePhase(next);
      if (message !== undefined) setSceneError(message);
      if (next === 'ready' || next === 'error') setSceneSlow(false);
    };
    // If the tiles have not arrived after a generous window, say so in the UI rather
    // than leaving the operator staring at an unexplained "UNKNOWN" verdict forever.
    const slowTimer = window.setTimeout(() => {
      if (disposed) return;
      if (phase !== 'ready' && phase !== 'error') setSceneSlow(true);
    }, SLOW_SCENE_WARNING_MS);

    const scene = viewer.scene;

    // --- Plaster void aesthetic ------------------------------------------------
    // No sky, no atmosphere, no sun, no moon — a hazy void, not a GIS map.
    scene.skyBox.show = false;
    scene.skyAtmosphere.show = false;
    scene.sun.show = false;
    scene.moon.show = false;
    // Plaster-coloured globe base; strip any imagery (defensive — baseLayer:false
    // already adds none).
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#f4f4f4');
    scene.imageryLayers.removeAll();

    // Studio lighting + harsh shadows so the white plaster geometry actually reads
    // against the white void (US2 art-direction). WITHOUT this, white-on-white is
    // invisible — the buildings must be lit + cast shadows to be seen.
    viewer.shadows = true;
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    // Morning sun -> low angle -> long shadows + strong facade shading. INITIAL seed
    // only — the dateTime listener below keeps viewer.clock.currentTime in sync with
    // the store (US3), so the user-driven time always wins after mount.
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(dateTime.get());
    viewer.clock.shouldAnimate = false;

    // --- US3 time-scrub listener (Strategy B) -------------------------------------
    // Drive Cesium's native clock from the dateTime store: every store change (slider
    // scrub, datetime-local input, solver result click) pushes the new instant into
    // viewer.clock.currentTime, which Cesium uses to position the sun + cast shadows.
    // shouldAnimate stays FALSE: we are NOT playing the clock; we are pinning it.
    // Time-independent: occlusion is NEVER recomputed here (see store.ts invariant).
    const applyDateTime = (dt: Date) => {
      if (disposed || viewer.isDestroyed()) return;
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(dt);
      viewer.scene.requestRender();
    };
    applyDateTime(dateTime.get());
    const unsubDateTime = dateTime.listen(applyDateTime);

    // --- US6 camera profile listener ---------------------------------------------
    // Translate the authored sensor + focal + zoom into a PerspectiveFrustum.fov.
    // Cesium 1.143 docs: PerspectiveFrustum.fov is the horizontal FOV when width >=
    // height, otherwise vertical. fovToCesium returns hfov unchanged for landscape
    // (the only case this plaster-void viewport exercises), so we assign it directly.
    // The frustum is replaced in-place: viewer.camera.frustum is always a
    // PerspectiveFrustum by default (no orthographic switch in this app).
    const applyCamera = () => {
      if (disposed || viewer.isDestroyed()) return;
      const { sensorWidth, focalLength, zoom } = cameraProfile.get();
      const canvas = viewer.canvas as HTMLCanvasElement;
      const aspectRatio =
        canvas.height > 0 ? canvas.clientWidth / canvas.clientHeight : 1;
      const hfov = computeHorizontalFov(sensorWidth, focalLength * zoom);
      const frustum = viewer.camera.frustum as CesiumType.PerspectiveFrustum;
      frustum.fov = fovToCesium(hfov, aspectRatio);
      frustum.aspectRatio = aspectRatio;
      viewer.scene.requestRender();
    };
    applyCamera();
    const unsubCamera = cameraProfile.listen(applyCamera);

    // --- Plaster post-process (US2) --------------------------------------------
    // Depth-haze + film-grain stage from src/cesium/shaders/studioEnvironment.ts.
    // depthTestAgainstTerrain MUST stay true (set above): the shader reads the depth
    // texture to separate geometry from the void, and that depth is only populated
    // correctly when the globe is part of the depth test.
    scene.postProcessStages.add(createStudioEnvironmentStage(Cesium));

    // --- Local self-hosted tileset ---------------------------------------------
    // Cesium3DTileset.fromUrl is the non-deprecated factory (the ctor is deprecated
    // since 1.107). It resolves once the root tile metadata is loaded.
    Cesium.Cesium3DTileset.fromUrl(TILESET_URL)
      .then((tileset) => {
        if (disposed || viewer.isDestroyed()) return;
        viewer.scene.primitives.add(tileset);
        // Root metadata resolved: the building data EXISTS. Occlusion is still
        // undecided until the tile content actually streams (see runWhenLoaded).
        setPhase('streaming');
        // Uniform matte white geometry — the plaster/clay model look.
        tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#ffffff')" });
        tileset.shadows = Cesium.ShadowMode.ENABLED;
        // Debug hook for headless scene-state inspection (scripts/diagnose.mjs).
        (window as unknown as { __cesium?: unknown }).__cesium = {
          viewer,
          tileset,
          // lastOcclusion is updated by recomputeOcclusion() below. Initialised to
          // 'unknown' so the diagnostic can distinguish "not yet computed" from a
          // genuine 'clear' result.
          lastOcclusion: 'unknown' as OcclusionState,
          postProcessStages: scene.postProcessStages,
        };

        // --- Camera: frame the tileset robustly ----------------------------------
        // viewer.zoomTo flies the camera to optimally view the tileset's bounding volume,
        // GUARANTEEING the frustum contains it so Cesium selects the root tile and fetches
        // its content (tile.b3dm). Replaces fragile hand-rolled ECEF->carto camera math
        // (which placed the camera outside the frustum and silently culled the tileset).
        // Oblique pitch (-35deg) for the studio architectural-model look.
        void viewer.zoomTo(tileset, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 0));

        // --- US1 line-of-sight occlusion ----------------------------------------
        // Time-independent (see store.ts invariant): never recompute on dateTime.
        // Recompute when heights change (slider) or once the tileset finishes loading.
        let polylineEntity: CesiumType.Entity | undefined;

        const recompute = () => {
          if (disposed || viewer.isDestroyed()) return;
          // Lat/lon come from the Berlin defaults (Lichtenberger Brücke → Fernsehturm).
          // Heights are slider-driven in the store; defaults are 1.5 m / 210 m which
          // match OBSERVER_DEFAULT.heightAboveGround / TARGET_DEFAULT.heightAboveGround,
          // so we read the store directly (no double-count of the default).
          // Globe has NO terrain (baseLayer:false + no World Terrain), so ground ≈ 0
          // and height-above-ground ≈ height-above-ellipsoid.
          const observer: LatLonHeight = {
            lat: OBSERVER_DEFAULT.lat,
            lon: OBSERVER_DEFAULT.lon,
            height: observerHeight.get(),
          };
          const target: LatLonHeight = {
            lat: TARGET_DEFAULT.lat,
            lon: TARGET_DEFAULT.lon,
            height: targetHeight.get(),
          };

          const result = computeOcclusion(viewer, observer, target);
          polylineEntity = drawLineOfSight(
            viewer,
            observer,
            target,
            result.state,
            polylineEntity,
          );
          (window as unknown as { __cesium?: { lastOcclusion?: OcclusionState } }).__cesium!.lastOcclusion =
            result.state;
          // commitOcclusion treats 'occluded' OR 'marginal' as blocked.
          commitOcclusion(result.state === 'occluded' || result.state === 'marginal');
          // First real occlusion result -> the verdict shown in ControlPanel is now
          // backed by loaded geometry, so promote the phase out of 'streaming'.
          setPhase('ready');
        };

        // Initial compute: defer until tilesLoaded so we don't read an empty scene.
        // tilesLoaded transitions to true exactly once, when the load queue drains.
        const runWhenLoaded = () => {
          if (tileset.tilesLoaded) {
            recompute();
            return true;
          }
          return false;
        };
        if (!runWhenLoaded()) {
          // Poll until first loaded. tileset does not emit a 'tilesLoaded' event in
          // 1.143 — the boolean is updated each frame, so a rAF poll is the simplest
          // reliable gate. Use the BROWSER's requestAnimationFrame — Cesium does
          // not export its own alias in 1.143 (Cesium.requestAnimationFrame is
          // undefined at runtime).
          const poll = () => {
            if (disposed || viewer.isDestroyed()) return;
            if (runWhenLoaded()) return;
            requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        }

        // Recompute on slider changes (heights). Each .listen fires once per change.
        const unsubOh = observerHeight.listen(recompute);
        const unsubTh = targetHeight.listen(recompute);

        // Stash unsubs on the viewer for cleanup; Cesium doesn't own them so we
        // can't piggyback on viewer.destroy(). Includes the US3 (dateTime) + US6
        // (cameraProfile) listeners created above the tileset callback so the cleanup
        // array is the single source of truth for ALL store subscriptions.
        (viewer as unknown as { __cleanupFns?: Array<() => void> }).__cleanupFns = [
          () => unsubOh?.(),
          () => unsubTh?.(),
          () => unsubDateTime?.(),
          () => unsubCamera?.(),
        ];
      })
      .catch((err: unknown) => {
        if (!disposed) {
          // eslint-disable-next-line no-console
          console.error('[CesiumViewer] failed to load tileset', TILESET_URL, err);
          // T059 / FR-013: a console.error alone is a SILENT failure to the operator.
          // Surface the URL and the underlying reason in the panel too.
          const reason = err instanceof Error ? err.message : String(err);
          setPhase('error', `${TILESET_URL} — ${reason}`);
        }
      });

    // --- Cleanup (React 18/19 StrictMode double-mount safe) --------------------
    return () => {
      disposed = true;
      window.clearTimeout(slowTimer);
      const v = viewerRef.current;
      if (v && !v.isDestroyed()) {
        // Run any stashed non-Cesium cleanups (store listeners) before destroying.
        const fns = (v as unknown as { __cleanupFns?: Array<() => void> }).__cleanupFns;
        if (Array.isArray(fns)) {
          for (const fn of fns) {
            try {
              fn();
            } catch {
              /* ignore — best-effort unsub */
            }
          }
        }
        v.destroy();
      }
      viewerRef.current = null;
    };
  }, []);

  return (
    <>
      <div id="cesium-container" ref={containerRef} />
      {/* Overlay scaffold (T057): two side rails + a bottom dock. Panels are STATIC
          children of a flex rail rather than absolutely positioned at hand-tuned
          `top:` offsets, so their heights compose instead of colliding — legible and
          non-overlapping at 1280x800 and roomier at 1440x900 (see global.css). */}
      <div className="pv-overlay">
        <div className="pv-rail pv-rail--left">
          <ControlPanel
            scenePhase={scenePhase}
            sceneError={sceneError}
            sceneSlow={sceneSlow}
          />
          <CameraControls />
        </div>
        <div className="pv-rail pv-rail--right">
          <SolverSearch />
        </div>
        <div className="pv-dock">
          <HourTimeline />
        </div>
      </div>
    </>
  );
}

// Keep the TS-import-only symbol live so verbatimModuleSyntax / isolatedModules keep
// the import side-effect-free. (No runtime use; pure type-only.)
void TILESET_ECEF_CENTER;
