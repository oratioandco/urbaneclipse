/** The daily map: one path per body, hour marks, and the spot for the chosen time. */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatTime } from '../../../lib/berlinTime.js';
import {
  MIN_MOON_ILLUMINATION,
  alignmentLine,
  pointAtTime,
  type AlignmentLine,
  type DayPath,
  type PathPoint,
} from '../../../lib/dailyPaths.js';
import { litDiscPath } from '../../../lib/moonPhase.js';
import type { StreetMoment } from '../../../lib/streets.js';
import { FERNSEHTURM } from '../../../lib/landmarks.js';
import { VIEWPOINTS, type Viewpoint } from '../../../lib/viewpoints.js';
import type { Body } from '../../../lib/bodyPosition.js';

export interface PathPick {
  body: Body;
  point: PathPoint;
}

interface Props {
  paths: DayPath[];
  time: number;
  selected: { lat: number; lon: number } | null;
  onPickPath: (pick: PathPick) => void;
  onPickFree: (pos: { lat: number; lon: number }) => void;
  onPickViewpoint: (viewpoint: Viewpoint) => void;
  streets: StreetMoment[];
  onPickStreet: (moment: StreetMoment) => void;
  moon: { fraction: number; waxing: boolean };
}

const COLOR: Record<Body, string> = { sun: '#ff9d3c', moon: '#b8c6ff' };
/** Tapping within this many pixels of a path counts as tapping the path. */
const SNAP_PX = 26;
const LABEL_ROOM_PX = 34;

const label = (text: string, className: string) =>
  L.divIcon({ className: `ue-map-label ${className}`, html: `<span>${text}</span>`, iconSize: [0, 0] });

/** Leaflet has no gradient lines, so a fade is drawn as short pieces. */
const FADE_PIECES = 24;
/** The sun or moon sits this far from the tower on screen, at any zoom. */
const BODY_OFFSET_PX = 70;

/**
 * The line through the tower: it ends at the sun or moon on one side, and on the other runs
 * to the edge of the view, fading out. It is brightest where the disc is behind the tower.
 */
function drawAlignment(
  map: L.Map,
  layer: L.LayerGroup,
  body: Body,
  line: AlignmentLine,
  moon: { fraction: number; waxing: boolean },
): void {
  const tower = map.latLngToLayerPoint([FERNSEHTURM.lat, FERNSEHTURM.lon]);
  // Web Mercator keeps angles, so a bearing is also a direction on screen.
  const radians = (line.bodyAz * Math.PI) / 180;
  const toBody = L.point(Math.sin(radians), -Math.cos(radians));
  const color = COLOR[body];

  const bodyAt = tower.add(toBody.multiplyBy(BODY_OFFSET_PX));
  L.polyline([map.layerPointToLatLng(tower), map.layerPointToLatLng(bodyAt)], {
    color,
    weight: 1.5,
    opacity: 0.8,
    interactive: false,
  }).addTo(layer);
  const glyph =
    body === 'moon'
      ? `<svg viewBox="-1.1 -1.1 2.2 2.2"><circle r="1" class="ue-moon-glyph__dark"/><path class="ue-moon-glyph__lit" d="${litDiscPath(moon.fraction, moon.waxing)}"/></svg><span>Moon</span>`
      : '<i></i><span>Sun</span>';
  L.marker(map.layerPointToLatLng(bodyAt), {
    icon: L.divIcon({ className: `ue-map-body ue-map-body--${body}`, iconSize: [0, 0], html: glyph }),
    interactive: false,
    zIndexOffset: 650,
  }).addTo(layer);

  // Out the far side, to wherever the view ends in that direction.
  const size = map.getSize();
  const start = map.layerPointToContainerPoint(tower);
  const away = toBody.multiplyBy(-1);
  const toEdge = Math.min(
    away.x > 0 ? (size.x - start.x) / away.x : away.x < 0 ? -start.x / away.x : Infinity,
    away.y > 0 ? (size.y - start.y) / away.y : away.y < 0 ? -start.y / away.y : Infinity,
  );
  if (!(toEdge > 0) || !Number.isFinite(toEdge)) return;
  const metresPerPixel =
    map.distance(map.layerPointToLatLng(tower), map.layerPointToLatLng(tower.add(L.point(100, 0)))) / 100;
  const alignedPx = map.distance([FERNSEHTURM.lat, FERNSEHTURM.lon], [line.farEnd.lat, line.farEnd.lon]) / metresPerPixel;
  for (let i = 0; i < FADE_PIECES; i++) {
    const a = (i / FADE_PIECES) * toEdge;
    const b = ((i + 1) / FADE_PIECES) * toEdge;
    const fade = 1 - Math.max(0, (a / toEdge - 0.55) / 0.45);
    L.polyline(
      [map.layerPointToLatLng(tower.add(away.multiplyBy(a))), map.layerPointToLatLng(tower.add(away.multiplyBy(b)))],
      {
        color,
        weight: a < alignedPx ? 2 : 1,
        opacity: fade * (a < alignedPx ? 0.9 : 0.4),
        interactive: false,
      },
    ).addTo(layer);
  }
}

export default function TodayMap({
  paths,
  time,
  selected,
  onPickPath,
  onPickFree,
  onPickViewpoint,
  streets,
  onPickStreet,
  moon,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pathLayer = useRef<L.LayerGroup | null>(null);
  const liveLayer = useRef<L.LayerGroup | null>(null);
  const [zoom, setZoom] = useState(12);
  const streetLayer = useRef<L.LayerGroup | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const handlers = useRef({ paths, onPickPath, onPickFree, onPickViewpoint, onPickStreet });
  handlers.current = { paths, onPickPath, onPickFree, onPickViewpoint, onPickStreet };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = L.map(host, {
      center: [FERNSEHTURM.lat, FERNSEHTURM.lon],
      zoom: 12,
      minZoom: 10,
      zoomControl: false,
    });
    mapRef.current = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    streetLayer.current = L.layerGroup().addTo(map);
    pathLayer.current = L.layerGroup().addTo(map);
    liveLayer.current = L.layerGroup().addTo(map);

    L.marker([FERNSEHTURM.lat, FERNSEHTURM.lon], {
      icon: L.divIcon({
        className: 'ue-map-tower',
        html: '<i></i><span>Fernsehturm</span>',
        iconSize: [0, 0],
      }),
      interactive: false,
      zIndexOffset: 400,
    }).addTo(map);

    for (const viewpoint of VIEWPOINTS) {
      L.marker([viewpoint.lat, viewpoint.lon], {
        icon: L.divIcon({
          className: 'ue-map-viewpoint',
          html: `<i></i><span>${viewpoint.name}</span>`,
          iconSize: [0, 0],
        }),
        title: `${viewpoint.name}, curated spot`,
        zIndexOffset: 300,
      })
        .on('click', () => handlers.current.onPickViewpoint(viewpoint))
        .addTo(map);
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      let best: PathPick | undefined;
      let bestPx = SNAP_PX;
      for (const path of handlers.current.paths) {
        for (const point of path.segments.flat()) {
          const px = map.latLngToContainerPoint([point.lat, point.lon]).distanceTo(e.containerPoint);
          if (px < bestPx) {
            best = { body: path.body, point };
            bestPx = px;
          }
        }
      }
      if (best) handlers.current.onPickPath(best);
      else handlers.current.onPickFree({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    // Centre the tower in the part of the map the sheet leaves visible.
    const sheet = host.parentElement?.querySelector<HTMLElement>('.ue-sheet');
    if (sheet) {
      const wide = window.innerWidth > 760;
      map.panBy(
        wide
          ? [-(sheet.offsetWidth + sheet.offsetLeft) / 2, 0]
          : [0, sheet.offsetHeight / 2],
        { animate: false },
      );
    }
    const syncZoom = (): void => {
      host.dataset.detail = map.getZoom() >= 14 ? 'true' : 'false';
      setZoom(map.getZoom());
    };
    map.on('zoomend', syncZoom);
    // The line through the tower is drawn out to the edge of the view.
    map.on('moveend zoomend resize', () => setViewTick((n) => n + 1));
    syncZoom();

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Paths change with the day and the body filter.
  useEffect(() => {
    const layer = pathLayer.current;
    if (!layer) return;
    const map = mapRef.current;
    if (!map) return;
    layer.clearLayers();
    // Hour labels would pile up where the path nears the tower, so each one needs room.
    const placed: L.Point[] = [map.project([FERNSEHTURM.lat, FERNSEHTURM.lon], zoom)];
    for (const path of paths) {
      const color = COLOR[path.body];
      const faint = path.body === 'moon' && path.illumination < 0.25;
      for (const segment of path.segments) {
        // Split wherever the look changes. Heavy means the disc can be fully hidden;
        // a faint line means buildings hide the tower from that stretch.
        const look = (p: PathPoint) => (p.clear === false ? 'blocked' : p.kind === 'full' ? 'full' : 'partial');
        let run: PathPoint[] = [];
        const flush = (kind: string) => {
          if (run.length < 2) return;
          const blocked = kind === 'blocked';
          L.polyline(run.map((p) => [p.lat, p.lon] as [number, number]), {
            color,
            weight: blocked ? 1 : kind === 'full' ? 5 : 3,
            opacity: blocked ? 0.28 : faint ? 0.35 : 1,
            dashArray: faint && !blocked ? '2 6' : undefined,
            interactive: false,
          }).addTo(layer);
        };
        segment.forEach((p, i) => {
          if (i > 0 && look(p) !== look(segment[i - 1])) {
            run.push(p);
            flush(look(segment[i - 1]));
            run = [];
          }
          run.push(p);
        });
        if (run.length > 0) flush(look(run[run.length - 1]));

        for (const p of segment) {
          if (p.t % 3_600_000 !== 0) continue;
          const at = map.project([p.lat, p.lon], zoom);
          if (placed.some((other) => other.distanceTo(at) < LABEL_ROOM_PX)) continue;
          placed.push(at);
          L.marker([p.lat, p.lon], {
            icon: label(formatTime(new Date(p.t)).slice(0, 2), `ue-map-hour ue-map-hour--${path.body}`),
            interactive: false,
          }).addTo(layer);
        }
      }
    }
  }, [paths, zoom]);

  // The line through the tower for the chosen time, and the sphere's spot along it.
  useEffect(() => {
    const layer = liveLayer.current;
    const map = mapRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const path of paths) {
      // A moon this thin cannot be seen, so a marker for it would only mislead.
      if (path.body === 'moon' && path.illumination < MIN_MOON_ILLUMINATION) continue;
      const line = alignmentLine(path.body, time, FERNSEHTURM);
      if (line && map) drawAlignment(map, layer, path.body, line, moon);
      const p = pointAtTime(path, time);
      if (!p) continue;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: `ue-map-now ue-map-now--${path.body}`,
          iconSize: [0, 0],
          html: '<i></i><span>Stand here</span>',
        }),
        interactive: false,
        zIndexOffset: 600,
      }).addTo(layer);
    }
    if (selected) {
      L.marker([selected.lat, selected.lon], {
        icon: L.divIcon({ className: 'ue-map-selected', iconSize: [0, 0], html: '<i></i>' }),
        interactive: false,
        zIndexOffset: 700,
      }).addTo(layer);
    }
  }, [paths, time, selected, viewTick, moon]);

  // Only the streets lined up right now. The list and the slider cover the rest of the day.
  useEffect(() => {
    const layer = streetLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const moment of streets) {
      if (time < moment.from - 60_000 || time > moment.to + 60_000) continue;
      const ends: [number, number][] = [
        [moment.view.from.lat, moment.view.from.lon],
        [moment.view.to.lat, moment.view.to.lon],
      ];
      L.polyline(ends, { color: COLOR[moment.body], weight: 2.5, opacity: 0.95, interactive: false }).addTo(layer);
      // A wider invisible line makes thin streets easy to tap.
      L.polyline(ends, { color: '#000', weight: 18, opacity: 0.001, bubblingMouseEvents: false })
        .on('click', () => handlers.current.onPickStreet(moment))
        .addTo(layer);
      // Where to stand, pointing the way to look.
      L.marker(ends[0], {
        icon: L.divIcon({
          className: `ue-map-eye ue-map-eye--${moment.body}`,
          iconSize: [0, 0],
          html: `<i style="transform:translate(-50%,-50%) rotate(${moment.view.bearingDeg}deg)"></i>`,
        }),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(layer);
    }
  }, [streets, time]);

  return <div className="ue-map" ref={hostRef} data-testid="today-map" />;
}
