/**
 * CesiumViewer — the plaster-void scene island.
 *
 * Mounted `client:only="react"` from src/pages/index.astro. Astro NEVER runs this on
 * the server, so the `cesium` import stays out of the SSR module graph (Constitution
 * Principle I/IV; enforced by tests/unit/ssr-graph-guard.test.ts).
 *
 * The scene renders the SELF-HOSTED local 3D Tiles tileset served at
 * `/test_tile/tileset.json` (copied into public/test_tile). It needs NO Cesium Ion
 * token: the plaster void omits World Terrain and base imagery, so no Ion asset is
 * requested. The PUBLIC_CESIUM_ION_TOKEN env var is read defensively and applied only
 * if present — it never crashes when absent.
 */
import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';

// Local tileset is served by Astro from public/ at '/test_tile/tileset.json'.
// (data/ itself is NOT web-served; a build/cp step mirrors data/test_tile -> public/test_tile.)
const TILESET_URL = '/test_tile/tileset.json';

// Tileset root transform translation (ECEF), from data/test_tile/tileset.json.
// Used as a fallback camera target if the tileset's bounding sphere isn't populated yet.
// (Re-sync if the converter re-runs: `grep -o '"transform":\[\.\.\.\]' data/test_tile/tileset.json`.)
const TILESET_ECEF_CENTER = new Cesium.Cartesian3(3782802.4642903516, 902286.4677665455, 5038573.502874194);

export default function CesiumViewer(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

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

    // --- Local self-hosted tileset ---------------------------------------------
    // Cesium3DTileset.fromUrl is the non-deprecated factory (the ctor is deprecated
    // since 1.107). It resolves once the root tile metadata is loaded.
    Cesium.Cesium3DTileset.fromUrl(TILESET_URL)
      .then((tileset) => {
        if (disposed || viewer.isDestroyed()) return;
        viewer.scene.primitives.add(tileset);
        // Uniform matte white geometry — the plaster/clay model look.
        tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#ffffff')" });

        // --- Camera: frame the tileset robustly ----------------------------------
        // viewer.zoomTo flies the camera to optimally view the tileset's bounding volume,
        // GUARANTEEING the frustum contains it so Cesium selects the root tile and fetches
        // its content (tile.b3dm). Replaces fragile hand-rolled ECEF->carto camera math
        // (which placed the camera outside the frustum and silently culled the tileset).
        // Oblique pitch (-35deg) for the studio architectural-model look.
        void viewer.zoomTo(tileset, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 0));
      })
      .catch((err: unknown) => {
        if (!disposed) {
          // eslint-disable-next-line no-console
          console.error('[CesiumViewer] failed to load tileset', TILESET_URL, err);
        }
      });

    // --- Cleanup (React 18/19 StrictMode double-mount safe) --------------------
    return () => {
      disposed = true;
      const v = viewerRef.current;
      if (v && !v.isDestroyed()) {
        v.destroy();
      }
      viewerRef.current = null;
    };
  }, []);

  return <div id="cesium-container" ref={containerRef} />;
}
