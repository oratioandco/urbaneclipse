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
import { useStore } from '@nanostores/react';
import type * as CesiumType from 'cesium';
// Cesium is served as a UMD GLOBAL (window.Cesium) by vite-plugin-cesium + the
// /cesium/Cesium.js tag injected in index.astro. We use the global at runtime — NOT
// `import * as Cesium from 'cesium'` — so Vite never loads the npm cesium ESM in dev
// (which breaks on Cesium's CommonJS deps: mersenne-twister default-export error / 504).
// `import type` is fully erased at build, so this introduces no runtime dependency.
const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

import {
  createStudioEnvironmentStage,
  defaultStudioEnvironmentState,
  updateStudioUniforms,
} from '../../cesium/shaders/studioEnvironment.js';
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
  viewMode,
  pickMode,
  observerPosition,
  targetPosition,
  setObserverPosition,
  setTargetPosition,
  solverBody,
  searchArea,
  setSearchArea,
} from '../../store.js';
import { OBSERVER_DEFAULT, TARGET_DEFAULT } from '../../lib/berlin.js';
import { LICHTENBERGER_BRUECKE } from '../../lib/viewpoints.js';
import { resolveObserverHeight, resolveTargetHeight } from '../../lib/sceneHeights.js';
import { loadHeightmap } from '../../cesium/loadHeightmap.js';
import {
  pickGeographic,
  flyToMapView,
  flyToPreview,
  upsertMarker,
  OBSERVER_MARKER_ID,
  TARGET_MARKER_ID,
} from '../../cesium/placement.js';
import { findViewpoint } from '../../lib/viewpoints.js';
import { buildLandmarkPrimitive } from '../../cesium/landmarkModel.js';
import { sampleBody } from '../../lib/bodyPosition.js';
import { azAltTo } from '../../lib/silhouette.js';
import { FERNSEHTURM } from '../../lib/landmarks.js';
import {
  upsertCelestialDisc,
  removeCelestialDisc,
  CELESTIAL_DISC_ID,
} from '../../cesium/celestialDisc.js';
import {
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
  orthometricToEllipsoidal,
} from '../../lib/elevation.js';

/** Marker base height, guarding against a non-finite surface reading. */
function orthometricToEllipsoidalSafe(surfaceOrthometric: number): number {
  return Number.isFinite(surfaceOrthometric)
    ? orthometricToEllipsoidal(surfaceOrthometric)
    : orthometricToEllipsoidal(BERLIN_GROUND_ORTHOMETRIC_FALLBACK);
}
import { computeHorizontalFov, fovToCesium } from '../../lib/cameraMath.js';
import ControlPanel, { type ScenePhase } from './ControlPanel.js';
import PlacementControls from './PlacementControls.js';
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
  const solverBodyValue = useStore(solverBody);
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

  // DGM1 ground sampler. A ref rather than state: the occlusion recompute reads it
  // imperatively from inside the Cesium lifecycle, and a re-render must not remount
  // the viewer. Null until loaded (or if loading fails), in which case
  // resolveObserverHeight degrades to the Berlin mean and reports 'fallback'.
  const groundSamplerRef = useRef<((lat: number, lon: number) => number | undefined) | null>(
    null,
  );
  const [groundWarning, setGroundWarning] = useState<string | undefined>(undefined);
  /** Feedback for a click that hit nothing or landed outside Berlin (FR-013). */
  const [pickError, setPickError] = useState<string | undefined>(undefined);
  /** Where the observer's surface elevation came from, so the UI never implies more
   *  precision than the source supports. */
  const [observerSurfaceSource, setObserverSurfaceSource] = useState<
    'viewpoint' | 'terrain' | 'fallback' | undefined
  >(undefined);
  /** Where the drawn sun/moon actually is — surfaced so "no disc visible" is never
   *  ambiguous between "below the horizon" and "something broke". */
  const [discState, setDiscState] = useState<
    { altitude: number; azimuth: number; angularDiameterDeg: number; visible: boolean } | undefined
  >(undefined);

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
    // Torn down with the viewer; assigned once the tileset resolves.
    let cleanupPlacement: (() => void) | undefined;

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
    // The telephoto FOV is the PREVIEW shot's lens. It must NOT be applied in map
    // mode: fitting the whole city through a 3.4-degree pinhole is what parked the camera
    // ~1100 km away and left the scene an empty white void. The lens only means
    // something when you are actually framing the shot.
    const applyPreviewFov = () => {
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
    /** Wide overview lens for map mode. */
    const MAP_FOV_RAD = Cesium.Math.toRadians(60);
    const applyCamera = () => {
      // Changing the lens only re-frames when we are IN the preview shot.
      if (viewMode.get() === 'preview') applyPreviewFov();
    };
    const unsubCamera = cameraProfile.listen(applyCamera);

    // --- Plaster post-process (US2) --------------------------------------------
    // Depth-haze + film-grain stage from src/cesium/shaders/studioEnvironment.ts.
    // depthTestAgainstTerrain MUST stay true (set above): the shader reads the depth
    // texture to separate geometry from the void, and that depth is only populated
    // correctly when the globe is part of the depth test.
    const studioState = defaultStudioEnvironmentState();
    const studioStage = createStudioEnvironmentStage(Cesium, studioState);
    scene.postProcessStages.add(studioStage);

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

        // --- Camera: framed by applyViewMode() on init (see below) ---------------
        // NOT viewer.zoomTo(tileset): the camera FOV is the 3.4-degree telephoto lens, and
        // fitting the 28 km-wide city into that pinhole parks the camera ~1100 km up,
        // leaving an empty white void (only the depth-test-disabled markers show). The
        // scene is framed per view mode instead — a top-down map or the preview shot —
        // both at sane distances that actually load and render tiles.

        // --- US1 line-of-sight occlusion ----------------------------------------
        // Time-independent (see store.ts invariant): never recompute on dateTime.
        // Recompute when heights change (slider) or once the tileset finishes loading.
        let polylineEntity: CesiumType.Entity | undefined;

        const recompute = () => {
          if (disposed || viewer.isDestroyed()) return;

          // VERTICAL DATUM (the fix for the 72 m bug).
          //
          // The globe has NO terrain (baseLayer:false, no World Terrain), so it is a
          // bare ellipsoid at height 0 — but the BUILDINGS are baked ~73.5 m up, because
          // scripts/convert_tile.py lifts DHHN2016 normal heights to WGS84 ellipsoidal
          // by adding the 39.5 m geoid undulation. Feeding the store's heights straight
          // to Cesium (as this used to) put the observer ~72 m BELOW every building base.
          //
          // The store now holds human-facing values — eye height above the surface you
          // stand on, and height up the target above ITS OWN base — which are converted
          // here, applying the geoid exactly once. Ground comes from the DGM1 heightmap;
          // a curated viewpoint's surveyed deck elevation wins over it, because DGM1 is
          // bare-earth terrain and would return the rail cutting 8.8 m below the bridge.
          const sample = groundSamplerRef.current ?? (() => undefined);

          // Positions are now PLACED (map-first), not hardcoded. A position carrying a
          // viewpointId uses that viewpoint's surveyed surface (e.g. the bridge deck)
          // instead of the bare-earth terrain sample.
          const obsPos = observerPosition.get();
          const tgtPos = targetPosition.get();
          const viewpoint = obsPos.viewpointId ? findViewpoint(obsPos.viewpointId) : undefined;

          const obs = resolveObserverHeight(
            obsPos.lat,
            obsPos.lon,
            observerHeight.get(),
            sample,
            viewpoint,
          );
          const tgt = resolveTargetHeight(
            tgtPos.lat,
            tgtPos.lon,
            targetHeight.get(),
            sample,
          );

          const observer: LatLonHeight = {
            lat: obsPos.lat,
            lon: obsPos.lon,
            height: obs.ellipsoidalHeight,
          };
          const target: LatLonHeight = {
            lat: tgtPos.lat,
            lon: tgtPos.lon,
            height: tgt.ellipsoidalHeight,
          };

          // Markers reflect the placed positions and their resolved elevations.
          upsertMarker(
            viewer,
            OBSERVER_MARKER_ID,
            obsPos.lat,
            obsPos.lon,
            orthometricToEllipsoidalSafe(obs.surfaceOrthometric),
            obs.ellipsoidalHeight,
            Cesium.Color.fromCssColorString('#2f5136'),
            obsPos.label ?? 'Observer',
          );
          upsertMarker(
            viewer,
            TARGET_MARKER_ID,
            tgtPos.lat,
            tgtPos.lon,
            orthometricToEllipsoidalSafe(tgt.surfaceOrthometric),
            tgt.ellipsoidalHeight,
            Cesium.Color.fromCssColorString('#8c2f16'),
            tgtPos.label ?? 'Target',
          );

          const result = computeOcclusion(viewer, observer, target);
          polylineEntity = drawLineOfSight(
            viewer,
            observer,
            target,
            result.state,
            polylineEntity,
          );
          const dbg = (
            window as unknown as {
              __cesium?: {
                lastOcclusion?: OcclusionState;
                observerEllipsoidalHeight?: number;
                targetEllipsoidalHeight?: number;
                groundSource?: string;
                targetGroundSource?: string;
                targetSurfaceOrthometric?: number;
                heightmapReady?: boolean;
              };
            }
          ).__cesium!;
          dbg.lastOcclusion = result.state;
          // Exposed for scripts/diagnose.mjs: the datum fix is invisible in pixels, so
          // it is verified objectively from scene state instead.
          dbg.observerEllipsoidalHeight = obs.ellipsoidalHeight;
          dbg.targetEllipsoidalHeight = tgt.ellipsoidalHeight;
          dbg.groundSource = obs.surfaceSource;
          setObserverSurfaceSource(obs.surfaceSource);
          dbg.targetGroundSource = tgt.surfaceSource;
          dbg.targetSurfaceOrthometric = tgt.surfaceOrthometric;
          dbg.heightmapReady = groundSamplerRef.current !== null;
          // commitOcclusion treats 'occluded' OR 'marginal' as blocked.
          commitOcclusion(result.state === 'occluded' || result.state === 'marginal');
          // First real occlusion result -> the verdict shown in ControlPanel is now
          // backed by loaded geometry, so promote the phase out of 'streaming'.
          setPhase('ready');
        };

        // --- DGM1 ground elevation ----------------------------------------------
        // Loaded in parallel with the tiles. Occlusion is recomputed once it lands so
        // the first verdict is not silently based on the fallback elevation.
        void loadHeightmap().then((res) => {
          if (disposed) return;
          if (res.sampleGround) {
            groundSamplerRef.current = res.sampleGround;
            recompute();
          } else {
            // Never silent (FR-013): without real ground the sightline is computed
            // from an assumed Berlin mean and can be several metres out.
            setGroundWarning(
              `ground elevation unavailable (${res.error ?? 'unknown error'}) — ` +
                `using the ${BERLIN_GROUND_ORTHOMETRIC_FALLBACK} m Berlin mean`,
            );
          }
        });

        // --- Map-first placement -------------------------------------------------
        // Click to place the observer or target. Only active when pickMode is not
        // 'none', so the map stays pannable by default and a stray click cannot
        // silently relocate the scene.
        const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction((movement: { position: CesiumType.Cartesian2 }) => {
          if (disposed) return;
          const mode = pickMode.get();
          if (mode === 'none') return;

          const picked = pickGeographic(viewer, movement.position);
          if (!picked) {
            setPickError('That click did not hit the model — try clicking on the ground or a building.');
            return;
          }

          // setObserver/Target/SearchArea reject implausible coordinates; a ray that
          // grazes the horizon can return a point on the far side of the globe.
          const ok =
            mode === 'observer'
              ? setObserverPosition({ lat: picked.lat, lon: picked.lon })
              : mode === 'target'
                ? setTargetPosition({ lat: picked.lat, lon: picked.lon })
                : setSearchArea({
                    center: { lat: picked.lat, lon: picked.lon },
                    radiusM: searchArea.get()?.radiusM ?? 400,
                  });

          if (!ok) {
            setPickError('That point is outside Berlin — the pick was ignored.');
            return;
          }
          setPickError(undefined);
          pickMode.set('none');
          recompute();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // --- View mode ------------------------------------------------------------
        const frustumOf = () => viewer.camera.frustum as CesiumType.PerspectiveFrustum;

        const applyViewMode = (durationSec = 1.2) => {
          if (disposed || viewer.isDestroyed()) return;
          const sample = groundSamplerRef.current ?? (() => undefined);
          const obsPos = observerPosition.get();
          const tgtPos = targetPosition.get();
          const viewpoint = obsPos.viewpointId ? findViewpoint(obsPos.viewpointId) : undefined;

          if (viewMode.get() === 'map') {
            // MAP: a wide overview lens, and the studio haze OFF. The haze fades
            // geometry to white by ~8 km of eye-space distance — perfect for the
            // ground-level shot, but from a map viewpoint km overhead it would white
            // out the entire city. A map wants crisp geometry anyway.
            frustumOf().fov = MAP_FOV_RAD;
            studioStage.enabled = false;
            flyToMapView(viewer, obsPos, tgtPos, durationSec);
            return;
          }

          // PREVIEW: the telephoto lens and the haze, i.e. the actual photograph.
          applyPreviewFov();
          studioStage.enabled = true;
          const obs = resolveObserverHeight(
            obsPos.lat, obsPos.lon, observerHeight.get(), sample, viewpoint,
          );

          // AIM at the celestial body's height on the target, not the target's tip.
          // At a transit the sun/moon sits partway up the tower; aiming at the tip
          // pushes the disc — and the occultation, the whole point — to the frame edge.
          // Compute the height on the target where the body's line of sight crosses it,
          // and centre there so the eclipse lands mid-frame. Fall back to the tower top
          // when the body is down.
          const observerGeo = {
            lat: obsPos.lat,
            lon: obsPos.lon,
            ellipsoidalHeight: obs.ellipsoidalHeight,
          };
          const tgtTopEll = resolveTargetHeight(
            tgtPos.lat, tgtPos.lon, targetHeight.get(), sample,
          ).ellipsoidalHeight;

          const bodySample = sampleBody(solverBody.get(), dateTime.get(), obsPos.lat, obsPos.lon);
          let aimEll = tgtTopEll;
          if (bodySample.alt > 0) {
            const range = azAltTo(observerGeo, tgtPos.lat, tgtPos.lon, tgtTopEll).rangeM;
            const heightAtBody =
              obs.ellipsoidalHeight + range * Math.tan((bodySample.alt * Math.PI) / 180);
            // Clamp within the target so we never aim at sky above the tip or below base.
            aimEll = Math.min(tgtTopEll, Math.max(obs.ellipsoidalHeight + 5, heightAtBody));
          }

          flyToPreview(
            viewer,
            observerGeo,
            { lat: tgtPos.lat, lon: tgtPos.lon, ellipsoidalHeight: aimEll },
            durationSec,
          );

          // AUTO-FIT the lens to the target so it frames well from ANY distance: an
          // extreme telephoto that suits a 6 km shot massively overfills the same tower
          // from 1.3 km. Set the horizontal FOV to span the target's angular height with
          // margin (landscape frame → frustum.fov is horizontal; the tower is vertical,
          // so scale by aspect). Clamped to a sane telephoto-to-short range. The camera
          // panel still overrides this the moment the user picks a specific lens.
          const rangeToTarget = azAltTo(observerGeo, tgtPos.lat, tgtPos.lon, aimEll).rangeM;
          const targetSpanM = targetHeight.get();
          const angularHeightDeg =
            (Math.atan2(targetSpanM, Math.max(rangeToTarget, 1)) * 180) / Math.PI;
          const canvas = viewer.canvas as HTMLCanvasElement;
          const aspect =
            canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6;
          const fitHfovDeg = Math.min(45, Math.max(2, angularHeightDeg * 1.35 * aspect));
          frustumOf().fov = Cesium.Math.toRadians(fitHfovDeg);
        };
        // Frame the scene NOW that the tileset exists. Instant (duration 0) so tiles
        // begin streaming at the destination immediately rather than after a 1.2 s fly.
        applyViewMode(0);

        // --- Parametric Fernsehturm silhouette -----------------------------------
        // The LoD2 tile tower is unusable (prism, no sphere, 114 m short). Draw the
        // accurate solid-of-revolution the solver uses, so the preview shows the iconic
        // silhouette where the maths says it is — and it occludes the celestial disc,
        // which IS the urban eclipse. Depth-tested, so foreground buildings occlude it.
        try {
          scene.primitives.add(buildLandmarkPrimitive(FERNSEHTURM));
        } catch (err) {
          console.error('[CesiumViewer] landmark model failed', err);
        }

        // --- Celestial disc -------------------------------------------------------
        // Drawn from suncalc (the SAME ephemeris the solver uses), not Cesium's own
        // sun: Cesium falls back to the TEME frame without network EOP data and sits a
        // near-constant ~0.37 deg off — three quarters of a solar diameter — so its disc
        // would contradict the prediction this preview exists to illustrate.
        // See tests/unit/sun-agreement.test.ts.
        const applyDisc = () => {
          if (disposed || viewer.isDestroyed()) return;
          if (viewMode.get() !== 'preview') {
            removeCelestialDisc(viewer);
            setDiscState(undefined);
            studioState.sunVisible = 0; // no bloom off the preview
            return;
          }
          const sample = groundSamplerRef.current ?? (() => undefined);
          const obsPos = observerPosition.get();
          const viewpoint = obsPos.viewpointId ? findViewpoint(obsPos.viewpointId) : undefined;
          const obs = resolveObserverHeight(
            obsPos.lat, obsPos.lon, observerHeight.get(), sample, viewpoint,
          );
          try {
            const st = upsertCelestialDisc(
              viewer,
              { lat: obsPos.lat, lon: obsPos.lon, ellipsoidalHeight: obs.ellipsoidalHeight },
              solverBody.get(),
              dateTime.get(),
            );
            setDiscState(st);

            // Drive the studio sky bloom from the SAME body position as the disc, so
            // the glow sits exactly where the sun/moon is — behind the tower at a real
            // transit. Projecting the disc's world position keeps the bloom anchored as
            // the camera orbits or the clock scrubs.
            const canvas = viewer.canvas as HTMLCanvasElement;
            studioState.aspect =
              canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6;
            const body = solverBody.get();
            studioState.glowColor = body === 'moon' ? [0.9, 0.92, 0.98] : [1.0, 0.9, 0.72];
            studioState.glowStrength = body === 'moon' ? 0.45 : 0.95;
            studioState.skyTop = body === 'moon' ? [0.6, 0.64, 0.74] : [0.8, 0.83, 0.89];

            const disc = viewer.entities.getById(CELESTIAL_DISC_ID);
            const worldPos = st.visible
              ? disc?.position?.getValue(viewer.clock.currentTime)
              : undefined;
            const win = worldPos
              ? Cesium.SceneTransforms.worldToWindowCoordinates(scene, worldPos)
              : undefined;
            if (win && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
              studioState.sunUv = [
                win.x / canvas.clientWidth,
                1 - win.y / canvas.clientHeight,
              ];
              studioState.sunVisible = 1;
            } else {
              studioState.sunVisible = 0;
            }
            updateStudioUniforms(Cesium, studioStage, studioState);
          } catch (err) {
            // Never let a drawing failure take down the scene; report it instead.
            setDiscState(undefined);
            studioState.sunVisible = 0;
            updateStudioUniforms(Cesium, studioStage, studioState);
            console.error('[CesiumViewer] celestial disc failed', err);
          }
          viewer.scene.requestRender();
        };

        // --- Search-area overlay --------------------------------------------------
        const AREA_ENTITY_ID = 'pv-search-area';
        const applyArea = () => {
          if (disposed || viewer.isDestroyed()) return;
          const existing = viewer.entities.getById(AREA_ENTITY_ID);
          if (existing) viewer.entities.remove(existing);

          const a = searchArea.get();
          if (!a) return;

          viewer.entities.add({
            id: AREA_ENTITY_ID,
            position: Cesium.Cartesian3.fromDegrees(a.center.lon, a.center.lat),
            ellipse: {
              semiMajorAxis: a.radiusM,
              semiMinorAxis: a.radiusM,
              material: Cesium.Color.fromCssColorString('#8a6410').withAlpha(0.12),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString('#8a6410').withAlpha(0.7),
              outlineWidth: 2,
              // Draped on the globe so it reads as a footprint on the ground rather
              // than a disc floating at an arbitrary height.
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          });
          viewer.scene.requestRender();
        };
        const unsubArea = searchArea.listen(applyArea);
        applyArea();

        const unsubDiscTime = dateTime.listen(() => {
          applyDisc();
          // Re-aim the preview as the clock scrubs: the sun/moon moves up the tower, so
          // the eclipse centre moves. Instant re-frame (duration 0) keeps it snappy.
          if (viewMode.get() === 'preview') applyViewMode(0);
        });
        const unsubDiscBody = solverBody.listen(applyDisc);
        applyDisc();

        const unsubViewMode = viewMode.listen(() => {
          applyViewMode();
          applyDisc();
        });
        // Re-frame and re-solve whenever a position moves.
        const unsubObsPos = observerPosition.listen(() => {
          recompute();
          applyViewMode();
          applyDisc();
        });
        const unsubTgtPos = targetPosition.listen(() => { recompute(); applyViewMode(); });
        cleanupPlacement = () => {
          unsubArea();
          unsubDiscTime();
          unsubDiscBody();
          unsubViewMode();
          unsubObsPos();
          unsubTgtPos();
          clickHandler.destroy();
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
      // Placement listeners + the click handler outlive the tileset promise, so tear
      // them down explicitly or a StrictMode remount leaves a dead handler attached.
      try {
        cleanupPlacement?.();
      } catch {
        /* teardown must not throw */
      }
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
          <PlacementControls
            pickError={pickError}
            observerSurfaceSource={observerSurfaceSource}
          />
          <ControlPanel
            discState={discState}
            body={solverBodyValue}
            groundWarning={groundWarning}
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
