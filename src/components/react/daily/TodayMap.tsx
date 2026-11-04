/** The daily map: one path per body, hour marks, and the spot for the chosen time. */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatTime } from '../../../lib/berlinTime.js';
import { alignmentLine, pointAtTime, type DayPath, type PathPoint } from '../../../lib/dailyPaths.js';
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
}

const COLOR: Record<Body, string> = { sun: '#ff9d3c', moon: '#b8c6ff' };
/** Tapping within this many pixels of a path counts as tapping the path. */
const SNAP_PX = 26;
const LABEL_ROOM_PX = 34;

const label = (text: string, className: string) =>
  L.divIcon({ className: `ue-map-label ${className}`, html: `<span>${text}</span>`, iconSize: [0, 0] });

export default function TodayMap({ paths, time, selected, onPickPath, onPickFree, onPickViewpoint }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pathLayer = useRef<L.LayerGroup | null>(null);
  const liveLayer = useRef<L.LayerGroup | null>(null);
  const [zoom, setZoom] = useState(12);
  const handlers = useRef({ paths, onPickPath, onPickFree, onPickViewpoint });
  handlers.current = { paths, onPickPath, onPickFree, onPickViewpoint };

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
    if (!layer) return;
    layer.clearLayers();
    for (const path of paths) {
      const line = alignmentLine(path.body, time, FERNSEHTURM);
      if (line) {
        L.polyline(
          [
            [FERNSEHTURM.lat, FERNSEHTURM.lon],
            [line.farEnd.lat, line.farEnd.lon],
          ],
          { color: COLOR[path.body], weight: 1.5, opacity: 0.75, dashArray: '4 5', interactive: false },
        ).addTo(layer);
        L.polyline(
          [
            [FERNSEHTURM.lat, FERNSEHTURM.lon],
            [line.bodySide.lat, line.bodySide.lon],
          ],
          { color: COLOR[path.body], weight: 1, opacity: 0.35, dashArray: '1 6', interactive: false },
        ).addTo(layer);
        L.marker([line.bodySide.lat, line.bodySide.lon], {
          icon: L.divIcon({ className: `ue-map-body ue-map-body--${path.body}`, iconSize: [0, 0], html: '<i></i>' }),
          interactive: false,
          title: path.body === 'sun' ? 'Direction of the sun' : 'Direction of the moon',
        }).addTo(layer);
      }
      const p = pointAtTime(path, time);
      if (!p) continue;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: `ue-map-now ue-map-now--${path.body}`, iconSize: [0, 0], html: '<i></i>' }),
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
  }, [paths, time, selected]);

  return <div className="ue-map" ref={hostRef} data-testid="today-map" />;
}
