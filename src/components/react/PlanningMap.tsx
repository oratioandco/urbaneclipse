/**
 * PlanningMap — the 2D planning map (Leaflet + OpenStreetMap raster tiles).
 *
 * Rendered INSIDE the CesiumViewer island (client:only) as an overlay on top of the
 * Cesium canvas, shown only in 'map' view mode. The 3D scene stays mounted underneath:
 * the occlusion compute and the preview both still need it, and keeping it alive avoids
 * re-streaming the tileset on every MAP/PREVIEW toggle.
 *
 * All placement state flows through the existing store atoms — this component is a
 * thin Leaflet adapter over them (observer/target markers, line-of-sight polyline,
 * search-area circle, click-to-place while a pick mode is armed). Pure presentation +
 * store wiring; no Cesium import (Constitution Principle I).
 *
 * NOTE: the OSM tile layer needs network access at runtime, unlike the self-hosted
 * Cesium tileset. If the tiles cannot be reached the map still works — markers, line
 * and picking are fully functional on the empty (grey) background.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  observerPosition,
  targetPosition,
  searchArea,
  pickMode,
  isOccluded,
  setObserverPosition,
  setTargetPosition,
  setSearchArea,
} from '../../store.js';

export interface PlanningMapProps {
  /** Report a rejected/failed pick so the placement panel can say why (FR-013). */
  onPickError?: (message: string | undefined) => void;
}

/** Same colours as the Cesium markers / search-area ellipse, so MAP and PREVIEW agree. */
const OBSERVER_COLOR = '#2f5136';
const TARGET_COLOR = '#8c2f16';
const AREA_COLOR = '#8a6410';
/** Mirrors drawLineOfSight: green when the path is open, red when blocked. */
const LOS_CLEAR = '#2f7a3d';
const LOS_BLOCKED = '#b3352a';

export default function PlanningMap({ onPickError }: PlanningMapProps = {}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: [52.52, 13.42],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // --- Layers, updated imperatively from the store -------------------------
    const markerStyle = (color: string): L.CircleMarkerOptions => ({
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    });
    const observerMarker = L.circleMarker([0, 0], markerStyle(OBSERVER_COLOR));
    const targetMarker = L.circleMarker([0, 0], markerStyle(TARGET_COLOR));
    const losLine = L.polyline([], { color: LOS_CLEAR, weight: 2 });
    const areaCircle = L.circle([0, 0], {
      radius: 0,
      color: AREA_COLOR,
      weight: 2,
      opacity: 0.7,
      fillColor: AREA_COLOR,
      fillOpacity: 0.12,
    });
    let areaOnMap = false;

    const syncPositions = (): void => {
      const obs = observerPosition.get();
      const tgt = targetPosition.get();
      observerMarker.setLatLng([obs.lat, obs.lon]);
      targetMarker.setLatLng([tgt.lat, tgt.lon]);
      observerMarker.bindTooltip(obs.label ?? 'Observer', {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'pv-map-label',
      });
      targetMarker.bindTooltip(tgt.label ?? 'Target', {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'pv-map-label',
      });
      if (!map.hasLayer(observerMarker)) observerMarker.addTo(map);
      if (!map.hasLayer(targetMarker)) targetMarker.addTo(map);

      losLine.setLatLngs([
        [obs.lat, obs.lon],
        [tgt.lat, tgt.lon],
      ]);
      if (!map.hasLayer(losLine)) losLine.addTo(map);

      // Frame both markers whenever they move while the map is up.
      map.fitBounds(
        L.latLngBounds([obs.lat, obs.lon], [tgt.lat, tgt.lon]).pad(0.25),
      );
    };

    const syncOcclusion = (): void => {
      losLine.setStyle({ color: isOccluded.get() ? LOS_BLOCKED : LOS_CLEAR });
    };

    const syncArea = (): void => {
      const a = searchArea.get();
      if (!a) {
        if (areaOnMap) {
          map.removeLayer(areaCircle);
          areaOnMap = false;
        }
        return;
      }
      areaCircle.setLatLng([a.center.lat, a.center.lon]);
      areaCircle.setRadius(a.radiusM);
      if (!areaOnMap) {
        areaCircle.addTo(map);
        areaOnMap = true;
      }
    };

    const syncCursor = (): void => {
      container.style.cursor = pickMode.get() === 'none' ? '' : 'crosshair';
    };

    // --- Click-to-place --------------------------------------------------------
    const onMapClick = (e: L.LeafletMouseEvent): void => {
      const mode = pickMode.get();
      if (mode === 'none') return;

      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const ok =
        mode === 'observer'
          ? setObserverPosition({ lat, lon })
          : mode === 'target'
            ? setTargetPosition({ lat, lon })
            : setSearchArea({
                center: { lat, lon },
                radiusM: searchArea.get()?.radiusM ?? 400,
              });

      if (!ok) {
        onPickError?.('That point is outside Berlin — the pick was ignored.');
        return;
      }
      onPickError?.(undefined);
      pickMode.set('none');
    };
    map.on('click', onMapClick);

    // --- Store subscriptions ----------------------------------------------------
    const unsubs = [
      observerPosition.listen(syncPositions),
      targetPosition.listen(syncPositions),
      searchArea.listen(syncArea),
      pickMode.listen(syncCursor),
      isOccluded.listen(syncOcclusion),
    ];
    syncPositions();
    syncOcclusion();
    syncArea();
    syncCursor();

    // The container is mounted at its final size, but a tiles-visibility change or a
    // late layout pass can leave Leaflet with a stale size — recalc after mount.
    map.invalidateSize();

    return () => {
      for (const unsub of unsubs) unsub();
      map.remove();
    };
  }, [onPickError]);

  return <div className="pv-planning-map" ref={containerRef} data-testid="planning-map" />;
}
