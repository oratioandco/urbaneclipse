/**
 * The redesigned app: a daily map that leads into a spot preview.
 *
 * The URL hash holds the screen, so the back button and shared links work. The 3D scene
 * is loaded the first time a spot opens, which keeps the map's first paint fast, and then
 * stays mounted so returning to a spot does not re-stream the whole city.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { berlinDayOf, type BerlinDay } from '../../../lib/berlinTime.js';
import type { Body } from '../../../lib/bodyPosition.js';
import {
  dateTime,
  lensAutoFit,
  setObserverPosition,
  solverBody,
  viewMode,
} from '../../../store.js';
import type { SceneStatus } from '../CesiumViewer.js';
import SpotScreen from './SpotScreen.js';
import TodayScreen from './TodayScreen.js';
import type { SpotTarget } from './shared.js';

/** The self-hosted global must exist before the scene module evaluates. */
function loadCesiumGlobal(): Promise<void> {
  if ((window as unknown as { Cesium?: unknown }).Cesium) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/cesium/Cesium.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The 3D engine could not be loaded.'));
    document.head.appendChild(script);
  });
}

const CesiumViewer = lazy(async () => {
  await loadCesiumGlobal();
  return import('../CesiumViewer.js');
});

// Spots can be anywhere within 9 km of the tower. Production only ships the smaller core
// set until the wider one is hosted, so spots outside it show no buildings there.
const TILESET_URL =
  import.meta.env.PUBLIC_DAILY_TILESET_URL ??
  (import.meta.env.DEV ? '/berlin-9km/tileset.json' : undefined);

interface Route {
  day: BerlinDay;
  spot: SpotTarget | null;
}

function parseHash(): Route {
  const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
  const day = params.get('day') ?? berlinDayOf(new Date());
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!params.has('lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { day, spot: null };
  }
  const t = params.get('t');
  return {
    day,
    spot: {
      lat,
      lon,
      t: t ? Number(t) : undefined,
      body: (params.get('body') as Body) === 'moon' ? 'moon' : 'sun',
      label: params.get('label') ?? 'Your spot',
      viewpointId: params.get('vp') ?? undefined,
    },
  };
}

function toHash({ day, spot }: Route): string {
  const params = new URLSearchParams({ day });
  if (spot) {
    params.set('lat', spot.lat.toFixed(6));
    params.set('lon', spot.lon.toFixed(6));
    params.set('body', spot.body);
    params.set('label', spot.label);
    if (spot.t !== undefined) params.set('t', String(spot.t));
    if (spot.viewpointId) params.set('vp', spot.viewpointId);
  }
  return `#/${params.toString()}`;
}

export default function DailyApp(): JSX.Element {
  const [route, setRoute] = useState<Route>(parseHash);
  const [sceneWanted, setSceneWanted] = useState(route.spot !== null);
  const [status, setStatus] = useState<SceneStatus | null>(null);

  useEffect(() => {
    const onHash = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /** Moving between screens is a history entry; scrubbing within a spot is not. */
  const go = useCallback((next: Route, replace = false): void => {
    const url = toHash(next);
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setRoute(next);
  }, []);

  const { spot, day } = route;

  useEffect(() => {
    if (!spot) return;
    setSceneWanted(true);
    viewMode.set('preview');
    lensAutoFit.set(true);
    // Position only on a real move, so scrubbing time does not re-frame from scratch.
    setObserverPosition({ lat: spot.lat, lon: spot.lon, viewpointId: spot.viewpointId, label: spot.label });
  }, [spot?.lat, spot?.lon, spot?.viewpointId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!spot) return;
    solverBody.set(spot.body);
    if (spot.t !== undefined) dateTime.set(new Date(spot.t));
  }, [spot?.body, spot?.t]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSpot = useCallback((change: Partial<SpotTarget>): void => {
    setRoute((current) => {
      if (!current.spot) return current;
      const next = { ...current, spot: { ...current.spot, ...change } };
      window.history.replaceState(null, '', toHash(next));
      return next;
    });
  }, []);

  return (
    <div className="ue-app" data-screen={spot ? 'spot' : 'today'}>
      <div className="ue-stage" hidden={!spot}>
        {sceneWanted && (
          <Suspense fallback={<div className="ue-loader" role="status">Loading the 3D city…</div>}>
            <CesiumViewer chrome="none" tilesetUrl={TILESET_URL} paused={!spot} onStatus={setStatus} />
          </Suspense>
        )}
      </div>
      <TodayScreen
        day={day}
        active={!spot}
        onDay={(d) => go({ day: d, spot: null }, true)}
        onOpenSpot={(s) => go({ day, spot: s })}
      />
      {spot && (
        <SpotScreen
          // A new position starts fresh, so one spot's dates can never apply to the next.
          key={`${spot.lat},${spot.lon}`}
          spot={spot}
          status={status}
          onBack={() => go({ day, spot: null })}
          onChange={updateSpot}
        />
      )}
    </div>
  );
}
