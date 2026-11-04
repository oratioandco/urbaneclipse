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
 *     fovToCesium(computeHorizontalFov(sensor, focal*zoom)). Cesium 1.143
 *     PerspectiveFrustum.fov is documented as: horizontal FOV when width >= height,
 *     otherwise vertical. fovToCesium keeps the sensor's long-side angle in both cases,
 *     so we pass its result straight through.
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
  lensAutoFit,
  viewMode,
  observerPosition,
  targetPosition,
  solverBody,
  searchArea,
} from '../../store.js';
import { OBSERVER_DEFAULT, TARGET_DEFAULT } from '../../lib/berlin.js';
import { LICHTENBERGER_BRUECKE } from '../../lib/viewpoints.js';
import { resolveObserverHeight, resolveTargetHeight } from '../../lib/sceneHeights.js';
import { loadHeightmap } from '../../cesium/loadHeightmap.js';
import { createGroundTerrainProvider } from '../../cesium/groundTerrain.js';
import { sampleGroundClamped } from '../../lib/terrainTile.js';
import {
  startRestream,
  stepRestream,
  isRestreaming,
  type RestreamState,
} from '../../lib/restreamWatcher.js';
import {
  flyToMapView,
  flyToPreview,
  upsertMarker,
  OBSERVER_MARKER_ID,
  TARGET_MARKER_ID,
} from '../../cesium/placement.js';
import { findViewpoint } from '../../lib/viewpoints.js';
import { sampleBody } from '../../lib/bodyPosition.js';
import { skyPalette } from '../../lib/skyPalette.js';
import { azAltTo, directionOffsetECEF, geodeticToECEF } from '../../lib/silhouette.js';
import { FERNSEHTURM } from '../../lib/landmarks.js';
import { SPHERE_CENTRE_AGL } from '../../lib/dailyPaths.js';
import { computeDiscState } from '../../cesium/celestialDisc.js';
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
import { computeHorizontalFov, fovToCesium, limitFovForFrame } from '../../lib/cameraMath.js';
import ControlPanel, { type ScenePhase } from './ControlPanel.js';
import PlacementControls from './PlacementControls.js';
import PlanningMap from './PlanningMap.js';
import HourTimeline from './HourTimeline.js';
import SolverSearch from './SolverSearch.js';
import CameraControls from './CameraControls.js';

// The DEPLOYED app serves the committed core subset (public/berlin-core/, the
// Lichtenberger-Brücke -> Fernsehturm sightline). For the full 236-tile scene locally,
// set PUBLIC_TILESET_URL=/berlin/tileset.json in .env (the full tileset is gitignored).
const DEFAULT_TILESET_URL = import.meta.env.PUBLIC_TILESET_URL ?? '/berlin-core/tileset.json?v=enu3';

// Tileset root transform translation (ECEF), from data/test_tile/tileset.json.
// Used as a fallback camera target if the tileset's bounding sphere isn't populated yet.
// (Berlin tileset's root bounding-volume centre is in the same neighbourhood; this is
// only consulted before the root content loads.)
const TILESET_ECEF_CENTER = new Cesium.Cartesian3(3782802.4642903516, 902286.4677665455, 5038573.502874194);

/** Ground at full daylight. Well below the buildings' white, so the floor recedes. */
const GROUND_COLOR = '#7d7873';

/** How long the scene may stay in a non-ready phase before we warn the user (T059). */
const SLOW_SCENE_WARNING_MS = 25_000;

/** What a host without the built-in panels needs to know about the scene. */
export interface SceneStatus {
  phase: ScenePhase;
  /** Tiles are re-streaming after the camera moved. */
  restreaming: boolean;
  /** Whether buildings stand between the eye and the landmark's sphere. */
  sphereSightline: 'clear' | 'blocked' | 'unknown';
  /** Field of view across the frame's long side, degrees. */
  fovDeg?: number;
}

export interface CesiumViewerProps {
  /** 'none' renders the scene alone, for hosts that supply their own controls. */
  chrome?: 'panels' | 'none';
  tilesetUrl?: string;
  /** Stops rendering while the scene is hidden. */
  paused?: boolean;
  onStatus?: (status: SceneStatus) => void;
}

/** Stop this far short of the landmark axis, so a sightline test cannot hit the
 *  landmark's own coarse mesh and report it as an obstruction. */
const SIGHTLINE_STANDOFF_M = 40;

export default function CesiumViewer({
  chrome = 'panels',
  tilesetUrl,
  paused = false,
  onStatus,
}: CesiumViewerProps = {}): JSX.Element {
  const TILESET_URL = tilesetUrl ?? DEFAULT_TILESET_URL;
  const solverBodyValue = useStore(solverBody);
  const viewModeValue = useStore(viewMode);
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
  /** Brief loader while 3D Tiles re-stream after a Map->Preview reframe (e.g. a result
   *  click). Driven by the pure restreamWatcher against tileset.tilesLoaded. */
  const [sceneRestreaming, setSceneRestreaming] = useState(false);

  // DGM1 ground sampler. A ref rather than state: the occlusion recompute reads it
  // imperatively from inside the Cesium lifecycle, and a re-render must not remount
  // the viewer. Null until loaded (or if loading fails), in which case
  // resolveObserverHeight degrades to the Berlin mean and reports 'fallback'.
  const groundSamplerRef = useRef<((lat: number, lon: number) => number | undefined) | null>(
    null,
  );
  /**
   * Edge-extended ground, used ONLY where the DGM1 grid has no coverage. It is the exact
   * surface the globe renders out there (src/lib/terrainTile.ts edge-clamps the same
   * way), so a position outside the AOI resolves to the ground actually beneath it
   * instead of the Berlin mean — which sits up to 22 m BELOW the drawn terrain on the
   * northern fringe and would bury the camera.
   */
  const extrapolateGroundRef = useRef<((lat: number, lon: number) => number | undefined) | null>(
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

  const [sphereSightline, setSphereSightline] =
    useState<SceneStatus['sphereSightline']>('unknown');
  const [fovDeg, setFovDeg] = useState<number | undefined>(undefined);
  useEffect(() => {
    onStatus?.({ phase: scenePhase, restreaming: sceneRestreaming, sphereSightline, fovDeg });
  }, [onStatus, scenePhase, sceneRestreaming, sphereSightline, fovDeg]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) viewer.useDefaultRenderLoop = !paused;
  }, [paused]);

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
    // rAF handle for the post-reframe re-stream loader; cancelled on cleanup so a
    // StrictMode remount/unmount mid-poll cannot setState after teardown.
    let restreamRaf: number | null = null;
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
    // Well below the buildings' white. The globe carries real terrain and is IN SHOT at
    // street level, and a bright floor would become the largest shape in the frame.
    // Heightmap terrain has no vertex normals, so Cesium cannot relief-shade it — it
    // renders at full intensity. Left at the buildings' own #f4f4f4 it comes out
    // BRIGHTER than every lit facade and the model reads as a light box rather than
    // clay standing on a plinth.
    scene.globe.baseColor = Cesium.Color.fromCssColorString(GROUND_COLOR);
    // Crisp edges: silhouettes against the sky are the whole picture. Capped at 2x, since
    // the post-process stage runs per pixel and a 3x phone would pay for detail it can't show.
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    scene.msaaSamples = 4;
    scene.imageryLayers.removeAll();

    // ONE reusable directional light, created up front: assigning a fresh
    // DirectionalLight per time-scrub would force shader recompiles (and stall the
    // renderer); mutating direction/intensity is uploaded per-frame as a uniform.
    const sunLight = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0, 0, -1),
      intensity: 1.5,
    });
    scene.light = sunLight;
    // Studio lighting WITHOUT shadow maps: the LoD2 tiles' per-face normals +
    // image-based ambient fill carry the clay form (lit vs shaded facades), so
    // contact shadows are not needed — and Cesium's shadow map at city scale
    // self-shadows into acne stripes. Shadows stay OFF; the directional key light
    // + IBL fill do the clay-model read.
    viewer.shadows = false;
    // Off: the terrain has no normals, and the engine's lighting fades with camera distance,
    // which draws a hard line across the ground. Its brightness follows the palette instead.
    scene.globe.enableLighting = false;
    scene.globe.depthTestAgainstTerrain = true;
    // The camera is AUTHORED from surveyed geometry (viewpoint deck elevation + eye
    // height), so Cesium must not second-guess it. Its collision detection otherwise
    // pushes the camera to `globeHeight + minimumZoomDistance` (1 m) whenever it reads
    // below that, and now that the globe carries real terrain the preview eye sits only
    // 0.5 m above that floor — a coarse-LOD tile reading half a metre high would pin the
    // camera and silently override the photographer's eye height, while leaving the
    // pitch that was computed from the UNclamped position. The framing would then no
    // longer match the geometry the solver used.
    scene.screenSpaceCameraController.enableCollisionDetection = false;
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
    // height, otherwise vertical. fovToCesium keeps the sensor's long-side angle in both
    // cases, so we assign it directly.
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
      frustum.fov = limitFovForFrame(fovToCesium(hfov), aspectRatio);
      frustum.aspectRatio = aspectRatio;
      setFovDeg(Cesium.Math.toDegrees(frustum.fov));
      viewer.scene.requestRender();
    };
    // Set once the tileset callback defines applyDisc; lets the (earlier-defined)
    // camera listener refresh the disc size after an authored-lens FOV change.
    let refreshDisc: () => void = () => {};
    const applyCamera = () => {
      // Changing the lens only re-frames when we are IN the preview shot, and only
      // when the lens is AUTHORED — in auto-fit mode the framing owns the frustum.
      if (viewMode.get() === 'preview' && !lensAutoFit.get()) {
        applyPreviewFov();
        refreshDisc(); // the FOV change alters the disc's on-screen size
      }
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

    // The horizon has to track the camera every frame, or a fallback ground could lag
    // behind a re-framed shot and open a strip of sky under the horizon.
    const scratchLevel = new Cesium.Cartesian3();
    const scratchUp = new Cesium.Cartesian3();
    const scratchAlongUp = new Cesium.Cartesian3();
    const updateHorizon = (): void => {
      const eye = viewer.camera.positionWC;
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(eye, scratchUp);
      // The view direction flattened into the local horizontal plane.
      const along = Cesium.Cartesian3.multiplyByScalar(
        up,
        Cesium.Cartesian3.dot(viewer.camera.directionWC, up),
        scratchAlongUp,
      );
      const level = Cesium.Cartesian3.subtract(viewer.camera.directionWC, along, scratchLevel);
      if (Cesium.Cartesian3.magnitude(level) < 1e-6) return; // looking straight up or down
      Cesium.Cartesian3.normalize(level, level);
      Cesium.Cartesian3.multiplyByScalar(level, 10_000, level);
      Cesium.Cartesian3.add(eye, level, level);
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, level);
      const height = (viewer.canvas as HTMLCanvasElement).clientHeight;
      if (!win || height <= 0) return;
      const horizonY = 1 - win.y / height;
      if (horizonY !== studioState.horizonY) {
        studioState.horizonY = horizonY;
        updateStudioUniforms(Cesium, studioStage, studioState);
      }
    };
    const removeHorizonListener = scene.preRender.addEventListener(updateHorizon);

    // --- Local self-hosted tileset ---------------------------------------------
    // Cesium3DTileset.fromUrl is the non-deprecated factory (the ctor is deprecated
    // since 1.107). It resolves once the root tile metadata is loaded.
    // The converter writes glTF vertices in a local East/North/Up frame with Z as up,
    // then carries ENU→ECEF in each tile transform. Cesium otherwise assumes glTF's
    // conventional Y-up and applies an extra Y→Z rotation, tipping the city geometry.
    Cesium.Cesium3DTileset.fromUrl(TILESET_URL, { modelUpAxis: Cesium.Axis.Z })
      .then((tileset) => {
        if (disposed || viewer.isDestroyed()) return;
        viewer.scene.primitives.add(tileset);
        // Root metadata resolved: the building data EXISTS. Occlusion is still
        // undecided until the tile content actually streams (see runWhenLoaded).
        setPhase('streaming');
        // Uniform matte white geometry — the plaster/clay model look. The tiles
        // now carry per-face flat normals (scripts/convert_tile.py flat_normals),
        // so the directional light + image-based ambient fill shade each facade
        // by orientation. luminanceAtZenith is the soft hemisphere fill that keeps
        // shaded facades reading as clay rather than pure black; applyDisc() drives
        // it from the time-of-day palette (low at night, full by day). (IBL is
        // already enabled by default via imageBasedLightingFactor; Cesium supplies
        // neutral default spherical harmonics, so luminanceAtZenith is the only
        // knob — `enabled` itself is a read-only getter.)
        tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#ffffff')" });
        tileset.imageBasedLighting.luminanceAtZenith = 0.6;
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
          const extrapolate = extrapolateGroundRef.current ?? undefined;

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
            extrapolate,
          );
          const tgt = resolveTargetHeight(
            tgtPos.lat,
            tgtPos.lon,
            targetHeight.get(),
            sample,
            extrapolate,
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
          const planningAidsVisible = viewMode.get() === 'map';
          const observerMarker = viewer.entities.getById(OBSERVER_MARKER_ID);
          const targetMarker = viewer.entities.getById(TARGET_MARKER_ID);
          if (observerMarker) observerMarker.show = planningAidsVisible;
          if (targetMarker) targetMarker.show = planningAidsVisible;
          if (polylineEntity) polylineEntity.show = planningAidsVisible;
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
          const tgtBaseEll = tgt.ellipsoidalHeight - targetHeight.get();
          const sphereEll = tgtBaseEll + SPHERE_CENTRE_AGL;
          const sightRange = azAltTo(
            { lat: observer.lat, lon: observer.lon, ellipsoidalHeight: observer.height },
            target.lat,
            target.lon,
            sphereEll,
          ).rangeM;
          const f = Math.max(0, 1 - SIGHTLINE_STANDOFF_M / Math.max(sightRange, 1));
          const sphereSight = computeOcclusion(viewer, observer, {
            lat: observer.lat + (target.lat - observer.lat) * f,
            lon: observer.lon + (target.lon - observer.lon) * f,
            height: observer.height + (sphereEll - observer.height) * f,
          }).state;
          setSphereSightline(
            sphereSight === 'unknown'
              ? 'unknown'
              : sphereSight === 'occluded' || sphereSight === 'marginal'
                ? 'blocked'
                : 'clear',
          );
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
          if (disposed || viewer.isDestroyed()) return;
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

          // --- Ground the buildings ------------------------------------------------
          // Until this lands the globe is the bare WGS84 ellipsoid at height 0, while
          // the building tiles are baked at ellipsoidal heights (~77 m at Berlin's
          // ground) — so the whole city hovers ~77 m above the plaster surface. Feeding
          // the SAME DGM1 grid to the globe puts the ground back under the buildings.
          // Deliberately driven off the same load as the sampler: the rendered surface
          // and the occlusion elevations then come from one source and cannot drift.
          if (res.grid) {
            // Same grid, same edge-extension rule as the terrain sampler — so a position
            // outside the AOI resolves to the ground the globe actually draws there.
            // Set BEFORE the re-frame below, or applyViewMode would place the camera
            // from the Berlin mean again.
            const grid = res.grid;
            extrapolateGroundRef.current = (lat: number, lon: number) =>
              sampleGroundClamped(grid, lat, lon);
            try {
              viewer.scene.terrainProvider = createGroundTerrainProvider(res.grid);
              // Re-frame NOW. applyViewMode() already ran once, synchronously, before
              // this promise resolved — at which point the ground sampler was still null,
              // so the preview eye was placed on the 34 m Berlin mean (75.0 m) rather
              // than Strausberger Platz's real 75.5 m. That leaves the camera half a
              // metre UNDER the terrain that just installed, i.e. a plaster whiteout on
              // first load. Re-framing also hides most of the ground's ~75 m jump as the
              // provider swap invalidates every globe tile.
              applyViewMode(0);
              applyDisc();
              viewer.scene.requestRender();
            } catch (err) {
              // The scene is still usable with a flat globe (buildings float, but the
              // solver is unaffected), so report rather than tear the island down.
              console.error('[CesiumViewer] ground terrain failed', err);
              setGroundWarning(
                `ground terrain unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
                  `the buildings will render above the plaster surface`,
              );
            }
          }
        });

        // --- Map-first placement -------------------------------------------------
        // Placement picking lives on the 2D Leaflet planning map (PlanningMap.tsx),
        // which overlays the Cesium canvas in map mode — no Cesium click handler here.

        // --- View mode ------------------------------------------------------------
        const frustumOf = () => viewer.camera.frustum as CesiumType.PerspectiveFrustum;

        const applyViewMode = (durationSec = 1.2) => {
          if (disposed || viewer.isDestroyed()) return;
          const sample = groundSamplerRef.current ?? (() => undefined);
          const extrapolate = extrapolateGroundRef.current ?? undefined;
          const obsPos = observerPosition.get();
          const tgtPos = targetPosition.get();
          const viewpoint = obsPos.viewpointId ? findViewpoint(obsPos.viewpointId) : undefined;

          if (viewMode.get() === 'map') {
            // MAP: the 2D Leaflet planning map covers the canvas, so the user never
            // sees this framing — but the Cesium camera must still sit near the city
            // or no tiles stream and the occlusion ray-picks have nothing to hit.
            studioStage.enabled = false;
            flyToMapView(viewer, obsPos, tgtPos, durationSec);
            return;
          }

          // PREVIEW: the haze + the lens, i.e. the actual photograph.
          studioStage.enabled = true;
          const obs = resolveObserverHeight(
            obsPos.lat, obsPos.lon, observerHeight.get(), sample, viewpoint, extrapolate,
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
            tgtPos.lat, tgtPos.lon, targetHeight.get(), sample, extrapolate,
          ).ellipsoidalHeight;

          const bodySample = sampleBody(solverBody.get(), dateTime.get(), obsPos.lat, obsPos.lon);
          let aimEll = tgtTopEll;
          if (bodySample.alt > 0) {
            const range = azAltTo(observerGeo, tgtPos.lat, tgtPos.lon, tgtTopEll).rangeM;
            const heightAtBody =
              obs.ellipsoidalHeight + range * Math.tan((bodySample.alt * Math.PI) / 180);
            // Put the eclipse in the upper third instead of dead centre. Aiming below
            // the body reveals the Frankfurter-Allee street valley while keeping the
            // complete tower inside the telephoto frame.
            const targetBaseEll = tgtTopEll - targetHeight.get();
            const compositionDropM = Math.min(90, targetHeight.get() * 0.22);
            aimEll = Math.min(
              tgtTopEll,
              Math.max(targetBaseEll + 5, heightAtBody - compositionDropM),
            );
          }

          flyToPreview(
            viewer,
            observerGeo,
            { lat: tgtPos.lat, lon: tgtPos.lon, ellipsoidalHeight: aimEll },
            durationSec,
          );

          // The lens: AUTO-FIT frames the target from ANY distance (an extreme
          // telephoto that suits a 6 km shot massively overfills the same tower from
          // 1.3 km); the AUTHORED lens (camera profile) applies once the user picks
          // one — lensAutoFit decides, so the two never fight over the frustum.
          if (lensAutoFit.get()) {
            // Horizontal FOV spans the target's angular height with margin (landscape
            // frame → frustum.fov is horizontal; the tower is vertical, so scale by
            // aspect). Clamped to a sane telephoto-to-short range.
            const rangeToTarget = azAltTo(observerGeo, tgtPos.lat, tgtPos.lon, aimEll).rangeM;
            const targetSpanM = targetHeight.get();
            const angularHeightDeg =
              (Math.atan2(targetSpanM, Math.max(rangeToTarget, 1)) * 180) / Math.PI;
            const canvas = viewer.canvas as HTMLCanvasElement;
            const aspect =
              canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6;
            // In a portrait frame frustum.fov is already the vertical angle.
            const fitHfovDeg = Math.min(
              45,
              Math.max(2, angularHeightDeg * 1.5 * Math.max(aspect, 1)),
            );
            frustumOf().fov = Cesium.Math.toRadians(fitHfovDeg);
          } else {
            applyPreviewFov();
          }
          setFovDeg(Cesium.Math.toDegrees(frustumOf().fov));
        };
        // Frame the scene NOW that the tileset exists. Instant (duration 0) so tiles
        // begin streaming at the destination immediately rather than after a 1.2 s fly.
        applyViewMode(0);

        // --- Celestial disc + atmosphere ------------------------------------------
        // The disc is drawn by the studio post-process SHADER on background pixels
        // (src/cesium/shaders/studioEnvironment.ts), so city geometry occults it
        // per-pixel at any range — no billboard entity. Its direction comes from
        // suncalc (the SAME ephemeris the solver uses), not Cesium's own sun, which
        // sits ~0.37 deg off the prediction (tests/unit/sun-agreement.test.ts).
        const applyDisc = () => {
          if (disposed || viewer.isDestroyed()) return;
          if (viewMode.get() !== 'preview') {
            setDiscState(undefined);
            studioState.sunVisible = 0; // no disc/bloom off the preview
            studioState.towerVisible = 0;
            updateStudioUniforms(Cesium, studioStage, studioState);
            return;
          }
          const sample = groundSamplerRef.current ?? (() => undefined);
          const extrapolate = extrapolateGroundRef.current ?? undefined;
          const obsPos = observerPosition.get();
          const viewpoint = obsPos.viewpointId ? findViewpoint(obsPos.viewpointId) : undefined;
          const obs = resolveObserverHeight(
            obsPos.lat, obsPos.lon, observerHeight.get(), sample, viewpoint, extrapolate,
          );
          const body = solverBody.get();
          const observerGeo = {
            lat: obsPos.lat,
            lon: obsPos.lon,
            ellipsoidalHeight: obs.ellipsoidalHeight,
          };
          try {
            // Time-of-day palette from the SAME suncalc altitude the disc and the
            // solver use — sky, haze, bloom, disc tint and scene light all agree.
            const bodySample = sampleBody(body, dateTime.get(), obsPos.lat, obsPos.lon);
            const palette = skyPalette(body, bodySample.alt);
            const st = computeDiscState(body, dateTime.get(), obsPos.lat, obsPos.lon);
            setDiscState(st);

            // Scene light from the suncalc direction (NOT Cesium's clock-driven sun,
            // which sits ~0.37 deg off the prediction): the globe's shading follows
            // the drawn disc and dims to nothing through twilight. MUTATE the one
            // shared light — see the creation site for why.
            const sunPoint = directionOffsetECEF(observerGeo, bodySample.az, bodySample.alt, 1);
            const obsEcef = geodeticToECEF(obsPos.lat, obsPos.lon, obs.ellipsoidalHeight);
            const lightDir = new Cesium.Cartesian3(
              obsEcef[0] - sunPoint[0],
              obsEcef[1] - sunPoint[1],
              obsEcef[2] - sunPoint[2],
            );
            Cesium.Cartesian3.normalize(lightDir, lightDir);
            sunLight.direction = lightDir;
            sunLight.intensity = palette.lightIntensity;
            // Sky-ambient fill follows the same time-of-day curve: bright skylight
            // by day (shaded facades read as soft clay), a trace by night.
            tileset.imageBasedLighting.luminanceAtZenith = palette.ambientLevel;
            const groundLevel = Math.min(1, 0.12 + palette.ambientLevel * 1.5);
            scene.globe.baseColor = Cesium.Color.multiplyByScalar(
              Cesium.Color.fromCssColorString(GROUND_COLOR),
              groundLevel,
              new Cesium.Color(),
            );
            scene.globe.baseColor.alpha = 1;
            // The vignette and depth tone a nearby ground would get, so the fallback matches.
            studioState.groundColor = [
              scene.globe.baseColor.red * 0.48 * palette.sceneTint[0],
              scene.globe.baseColor.green * 0.48 * palette.sceneTint[1],
              scene.globe.baseColor.blue * 0.48 * palette.sceneTint[2],
            ];

            // Drive the studio sky + disc from the SAME body position, so the glow
            // sits exactly where the sun/moon is — behind the tower at a real
            // transit. Projecting a point along the body's direction keeps the disc
            // anchored as the camera orbits or the clock scrubs (the distance is
            // irrelevant to the projection; 10 km stays well inside the frustum).
            const canvas = viewer.canvas as HTMLCanvasElement;
            studioState.aspect =
              canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6;
            studioState.glowColor = palette.glowColor;
            studioState.glowStrength = palette.glowStrength;
            studioState.skyTop = palette.skyTop;
            studioState.haze = palette.haze;
            studioState.discColor = palette.discTint;
            // The tiles have no usable normals, so the post-process — not scene
            // lighting — darkens/warms the city for night and golden hour.
            studioState.sceneTint = palette.sceneTint;

            const anchor = directionOffsetECEF(observerGeo, st.azimuth, st.altitude, 10_000);
            const win = st.visible
              ? Cesium.SceneTransforms.worldToWindowCoordinates(
                  scene,
                  new Cesium.Cartesian3(anchor[0], anchor[1], anchor[2]),
                )
              : undefined;
            if (win && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
              studioState.sunUv = [
                win.x / canvas.clientWidth,
                1 - win.y / canvas.clientHeight,
              ];
              // Angular radius -> fraction of frame height. frustum.fov is the
              // HORIZONTAL fov in this landscape viewport; convert to vertical.
              const frustum = viewer.camera.frustum as CesiumType.PerspectiveFrustum;
              const aspect = canvas.clientWidth / canvas.clientHeight;
              // frustum.fov is horizontal in a landscape frame and vertical in portrait.
              const vfov =
                aspect >= 1 ? 2 * Math.atan(Math.tan(frustum.fov / 2) / aspect) : frustum.fov;
              const angRadiusRad = ((st.angularDiameterDeg / 2) * Math.PI) / 180;
              studioState.sunRadius = Math.tan(angRadiusRad) / (2 * Math.tan(vfov / 2));
              studioState.sunVisible = 1;
            } else {
              studioState.sunVisible = 0;
            }

            // Project the two edges of the 32 m sphere, which remain numerically stable
            // even when a tight lens puts the tower base or antenna tip off-screen.
            // Extrapolate the full 368.03 m axis from that stable local scale.
            const towerBaseEll = orthometricToEllipsoidal(FERNSEHTURM.baseOrthometric);
            const sphereBottomDirection = azAltTo(
              observerGeo,
              FERNSEHTURM.lat,
              FERNSEHTURM.lon,
              towerBaseEll + 197,
            );
            const sphereTopDirection = azAltTo(
              observerGeo,
              FERNSEHTURM.lat,
              FERNSEHTURM.lon,
              towerBaseEll + 229,
            );
            const sphereBottomPoint = directionOffsetECEF(
              observerGeo,
              sphereBottomDirection.az,
              sphereBottomDirection.alt,
              10_000,
            );
            const sphereTopPoint = directionOffsetECEF(
              observerGeo,
              sphereTopDirection.az,
              sphereTopDirection.alt,
              10_000,
            );
            const towerSphereBottom = Cesium.SceneTransforms.worldToWindowCoordinates(
              scene,
              new Cesium.Cartesian3(...sphereBottomPoint),
            );
            const towerSphereTop = Cesium.SceneTransforms.worldToWindowCoordinates(
              scene,
              new Cesium.Cartesian3(...sphereTopPoint),
            );
            if (
              towerSphereBottom && towerSphereTop &&
              canvas.clientWidth > 0 && canvas.clientHeight > 0
            ) {
              const dxPerM = (towerSphereTop.x - towerSphereBottom.x) / 32;
              const dyPerM = (towerSphereTop.y - towerSphereBottom.y) / 32;
              const baseX = towerSphereBottom.x - dxPerM * 197;
              const baseY = towerSphereBottom.y - dyPerM * 197;
              const topX = towerSphereBottom.x + dxPerM * (368.03 - 197);
              const topY = towerSphereBottom.y + dyPerM * (368.03 - 197);
              studioState.towerBaseUv = [baseX / canvas.clientWidth, 1 - baseY / canvas.clientHeight];
              studioState.towerTopUv = [topX / canvas.clientWidth, 1 - topY / canvas.clientHeight];
              studioState.towerVisible = 1;
              studioState.towerRange = sphereBottomDirection.rangeM;
            } else {
              studioState.towerVisible = 0;
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
        refreshDisc = applyDisc;

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

        // --- Post-reframe re-stream loader ---------------------------------------
        // Entering preview reframes top-down map -> street-level telephoto, forcing 3D
        // Tiles to re-stream for the new view. Show a brief "Framing the shot…" loader
        // until the tile queue drains. Cesium emits no tilesLoaded event in 1.143, so we
        // rAF-poll the boolean the rest of the codebase already trusts; the pure
        // restreamWatcher (src/lib/restreamWatcher.ts) hides it past a hard deadline so
        // it can never pin the user behind a spinner under SwiftShader.
        let restream: RestreamState = { kind: 'idle' };
        const applyRestream = (next: RestreamState): void => {
          restream = next;
          setSceneRestreaming(isRestreaming(next));
        };
        const startRestreamWatch = (): void => {
          if (disposed || viewer.isDestroyed()) return;
          if (restreamRaf !== null) cancelAnimationFrame(restreamRaf);
          applyRestream(startRestream(performance.now()));
          const tick = (): void => {
            if (disposed || viewer.isDestroyed()) {
              restreamRaf = null;
              return;
            }
            const next = stepRestream(restream, {
              tilesLoaded: tileset.tilesLoaded,
              now: performance.now(),
            });
            applyRestream(next);
            if (next.kind === 'watching') {
              restreamRaf = requestAnimationFrame(tick);
            } else {
              restreamRaf = null;
            }
          };
          restreamRaf = requestAnimationFrame(tick);
        };

        const unsubViewMode = viewMode.listen((mode) => {
          // Instant (duration 0), never an animated fly: in map mode the camera is
          // left wherever it was (potentially very far away), so a flyTo into the
          // preview would drag the whole tile-streaming pipeline across the globe.
          applyViewMode(0);
          applyDisc();
          const planningAidsVisible = mode === 'map';
          const observerMarker = viewer.entities.getById(OBSERVER_MARKER_ID);
          const targetMarker = viewer.entities.getById(TARGET_MARKER_ID);
          if (observerMarker) observerMarker.show = planningAidsVisible;
          if (targetMarker) targetMarker.show = planningAidsVisible;
          if (polylineEntity) polylineEntity.show = planningAidsVisible;
          // Only map->preview has a visible re-stream: in map mode the Leaflet planning
          // map covers the canvas, so preview->map needs no loader.
          if (mode === 'preview') startRestreamWatch();
        });
        // Flipping back to AUTO framing re-fits the lens immediately.
        const unsubLens = lensAutoFit.listen(() => {
          if (viewMode.get() === 'preview') {
            applyViewMode(0);
            applyDisc(); // the FOV change alters the disc's on-screen size
          }
        });
        // Re-frame and re-solve whenever a position moves.
        // The sightline can only be judged once the tiles along the new view have
        // streamed, so check again after the camera has moved and the queue has drained.
        let settleTimer: number | undefined;
        const recomputeWhenSettled = (): void => {
          window.clearTimeout(settleTimer);
          setSphereSightline('unknown');
          settleTimer = window.setTimeout(function check() {
            if (disposed || viewer.isDestroyed()) return;
            if (tileset.tilesLoaded) recompute();
            else settleTimer = window.setTimeout(check, 250);
          }, 500);
        };
        const unsubObsPos = observerPosition.listen(() => {
          recompute();
          applyViewMode(chrome === 'none' ? 0 : undefined);
          applyDisc();
          recomputeWhenSettled();
        });
        const resizeObserver = new ResizeObserver(() => {
          if (disposed || viewer.isDestroyed()) return;
          viewer.resize();
          if (viewMode.get() === 'preview') {
            applyViewMode(0);
            applyDisc();
          }
        });
        resizeObserver.observe(container);
        const unsubTgtPos = targetPosition.listen(() => { recompute(); applyViewMode(); });
        cleanupPlacement = () => {
          window.clearTimeout(settleTimer);
          resizeObserver.disconnect();
          unsubArea();
          unsubDiscTime();
          unsubDiscBody();
          unsubViewMode();
          unsubLens();
          unsubObsPos();
          unsubTgtPos();
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
        // Eye height moves the camera too, or the slider only changes the verdict.
        const unsubOh = observerHeight.listen(() => {
          recompute();
          if (viewMode.get() === 'preview') {
            applyViewMode(0);
            applyDisc();
          }
          recomputeWhenSettled();
        });
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
      removeHorizonListener();
      if (restreamRaf !== null) cancelAnimationFrame(restreamRaf);
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

  if (chrome === 'none') {
    return <div id="cesium-container" ref={containerRef} />;
  }

  return (
    <>
      <div id="cesium-container" ref={containerRef} />
      {/* 2D planning map: covers the Cesium canvas in map mode. The scene stays
          mounted underneath — occlusion + preview still need it. */}
      {viewModeValue === 'map' && <PlanningMap onPickError={setPickError} />}
      {/* Overlay scaffold (T057): two side rails + a bottom dock. Panels are STATIC
          children of a flex rail rather than absolutely positioned at hand-tuned
          `top:` offsets, so their heights compose instead of colliding — legible and
          non-overlapping at 1280x800 and roomier at 1440x900 (see global.css). */}
      <div className="pv-overlay">
        {viewModeValue === 'preview' && sceneRestreaming && (
          <div
            className="pv-scene-loader"
            role="status"
            aria-live="polite"
            data-testid="scene-restream-loader"
          >
            <span className="pv-scene-loader__spinner" aria-hidden="true" />
            Framing the shot…
          </div>
        )}
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
          {viewModeValue === 'preview' && (
            <section className="pv-panel pv-map-panel" aria-label="Top-down route overview">
              <header className="pv-map-panel__head">
                <span>Top view</span>
                <span>Observer → target</span>
              </header>
              <div className="pv-map-panel__canvas">
                <PlanningMap variant="inset" />
              </div>
              <div className="pv-map-panel__legend" aria-hidden="true">
                <span><i className="pv-map-panel__dot pv-map-panel__dot--observer" />Observer</span>
                <span><i className="pv-map-panel__dot pv-map-panel__dot--target" />Target</span>
              </div>
              <button
                type="button"
                className="pv-map-panel__open"
                onClick={() => viewMode.set('map')}
              >
                Open full map
              </button>
            </section>
          )}
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
