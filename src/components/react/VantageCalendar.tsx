/**
 * VantageCalendar — the bridge's alignment calendar, at real data (panel 05).
 *
 * THE PRODUCT MOMENT this component exists for: the photographer picks their standing
 * point on the Lichtenberger Brücke and reads the year's honest list — "11. Apr, 19:1x,
 * Sonnenscheibe auf der Spitze" — INCLUDING the entry that is deliberately absent:
 * mid-May, when the sun crosses the tower bearing far above the spire, there is no row,
 * and the caption says so in words.
 *
 * The panel answers the photographer's questions in the order they are asked on the
 * bridge: (1) "when is the next one?" — the Nächster-Termin head; (2) "will the sky
 * hold?" — weather verdicts on the next-3-days rows; (3) "what does the year look
 * like?" — the full list, with each moon row stating its illumination, because a
 * 2-percent crescent behind the spire is not the same shot as a full moon.
 *
 * Computation runs on demand (button press), on the main thread: a full-year
 * enumerateVantageWindows sweep measures well under a second, far below the worker
 * threshold SolverSearch needs for its per-instant area solves. If this ever grows a
 * per-minute refinement of the whole list, move it into a worker like SolverSearch's.
 *
 * Honesty rules carried over from the sketch panel: vantage names are the real OSM
 * standing points; needsSiteCheck points say so; a pass so low that the skyline probably
 * hides it is marked and never offered as the next date (lib/lowPass.ts). Times are Berlin
 * time and say so. Sun and moon rows are equally exact: the audit of November 2026 measured
 * both within 20 s of JPL DE421 (docs/accuracy-audit-2026-11.md). The
 * weather (Open-Meteo, next 3 days) only ANNOTATES the geometric list — a dead
 * forecast degrades the panel to its calendar, never the other way round.
 */
import { useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { LICHTENBERGER_BRUECKE, STRASSE_DES_17_JUNI, type Vantage } from '../../lib/vantages.js';
import { enumerateVantageWindows, type VantageWindow } from '../../lib/vantageWindows.js';
import { FERNSEHTURM, SIEGESSAEULE, type RevolutionLandmark } from '../../lib/landmarks.js';
import {
  columnBandAt,
  enumerateHorizonGatedWindows,
  horizonWindowsEnabled,
  type ColumnBand,
} from '../../lib/horizonWindows.js';
import type { Heightmap } from '../../lib/heightmap.js';
import { loadHeightmap } from '../../cesium/loadHeightmap.js';
import { sampleBody } from '../../lib/bodyPosition.js';
import { moonLighting } from '../../lib/moonPhase.js';
import { berlinZoneName, formatWhenDe } from '../../lib/berlinTime.js';
import { LOW_PASS_CENTRE_DEG, formatAltitudeDe, isLowPass, lowPassNote } from '../../lib/lowPass.js';
import {
  assessWindowWeather,
  formatAssessment,
  loadForecast,
  type WeatherAssessment,
} from '../../lib/shotWeather.js';
import { dateTime, viewMode } from '../../store.js';

const WINDOW_MONTHS = 12;

const BAND_LABEL: Record<VantageWindow['band'] | ColumnBand, string> = {
  spire: 'Spitze',
  sphere: 'Kugel',
  shaft: 'Schaft',
  base: 'Fuß',
  viktoria: 'Viktoria',
  column: 'Säule',
  hall: 'Sockel',
};

/** One calendar row, whichever target produced it. */
interface CalendarRow {
  body: VantageWindow['body'];
  peak: Date;
  coveredFraction: number;
  band: VantageWindow['band'] | ColumnBand;
  /** Horizon-gated targets only: does the disc clear the terrain skyline? */
  horizon?: 'frei' | 'verdeckt' | 'unsicher';
  /**
   * Targets without a horizon test only: the disc's centre is so low at the peak that the
   * skyline probably hides it. Carries the apparent altitude, degrees.
   */
  lowAltitudeDeg?: number;
}

interface Target {
  id: 'fernsehturm' | 'siegessaeule';
  label: string;
  vantage: Vantage;
  landmark: RevolutionLandmark;
  bearingLabel: string;
  /** Gate windows on the DGM1 terrain horizon (needs the heightmap stack). */
  horizonGated: boolean;
}

const TARGETS: Target[] = [
  {
    id: 'fernsehturm',
    label: 'Fernsehturm',
    vantage: LICHTENBERGER_BRUECKE,
    landmark: FERNSEHTURM,
    bearingLabel: 'Peilung zum Turm',
    horizonGated: false,
  },
  {
    id: 'siegessaeule',
    label: 'Siegessäule',
    vantage: STRASSE_DES_17_JUNI,
    landmark: SIEGESSAEULE,
    bearingLabel: 'Peilung',
    horizonGated: true,
  },
];

/**
 * The Siegessäule target is a preview: on with the build flag PUBLIC_HORIZON_WINDOWS, or
 * per visit with ?horizon=1 so it can be checked on the live site without shipping it.
 */
function horizonPreviewOn(): boolean {
  if (horizonWindowsEnabled()) return true;
  try {
    return new URLSearchParams(window.location.search).get('horizon') === '1';
  } catch {
    return false;
  }
}

/** Core 10 m grid first, then the 25 m horizon grid west to Teufelsberg; loaded once. */
let heightmapStack: Promise<Heightmap[]> | null = null;
function loadHeightmapStack(): Promise<Heightmap[]> {
  heightmapStack ??= Promise.all([
    loadHeightmap('/heightmap/berlin-dgm1'),
    loadHeightmap('/heightmap/berlin-dgm1-horizon'),
  ]).then((results) => {
    const grids = results.map((r) => r.grid).filter((g): g is Heightmap => g !== null);
    if (grids.length !== results.length) {
      heightmapStack = null; // let a later run retry
      throw new Error(results.map((r) => r.error).filter(Boolean).join('; '));
    }
    return grids;
  });
  return heightmapStack;
}

const BODY_LABEL: Record<VantageWindow['body'], string> = {
  sun: 'Sonne',
  moon: 'Mond',
};

/** "Fr., 3. Apr., 19:42", always Berlin time: the light and the city are Berlin's. */
const formatWhen = formatWhenDe;

/** Distance from the sweep's "now" in the words a photographer plans with. */
function formatIn(when: Date, now: Date): string {
  const days = (when.getTime() - now.getTime()) / 86_400_000;
  if (days < 0.5) return 'heute';
  if (days < 1.5) return 'morgen';
  if (days < 60) return `in ${Math.round(days)} Tagen`;
  return `in ${Math.round(days / 30.44)} Monaten`;
}

type WeatherState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; assessments: Map<string, WeatherAssessment> }
  | { status: 'error' };

export default function VantageCalendar() {
  const horizonOn = useMemo(horizonPreviewOn, []);
  const [targetId, setTargetId] = useState<Target['id']>('fernsehturm');
  const target = TARGETS.find((t) => t.id === targetId) ?? TARGETS[0]!;
  const [pointId, setPointId] = useState(LICHTENBERGER_BRUECKE.points[0]!.id);
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [windows, setWindows] = useState<CalendarRow[]>([]);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherState>({ status: 'idle' });
  // "Now" as of the sweep, so "in N Tagen" stays put while the panel sits open.
  const [sweptAt, setSweptAt] = useState<Date | null>(null);
  // Guards a stale weather answer from an earlier run landing on a newer list.
  const runSeq = useRef(0);
  // The scrubbed instant, to mark the live row like SolverSearch does.
  const dt = useStore(dateTime);

  const point = useMemo(
    // The registry is a non-empty constant; the ?? guards only the type, not reality.
    () => target.vantage.points.find((p) => p.id === pointId) ?? target.vantage.points[0]!,
    [pointId, target],
  );

  const reset = (): void => {
    runSeq.current++; // drop any in-flight terrain/weather answer
    setState('idle');
    setWindows([]);
    setWeather({ status: 'idle' });
    setTerrainError(null);
  };

  const assessmentFor = (w: CalendarRow): WeatherAssessment | undefined =>
    weather.status === 'ok' ? weather.assessments.get(w.peak.toISOString()) : undefined;

  const sweep = (now: Date, end: Date, grids: Heightmap[] | null): CalendarRow[] => {
    const bodyAt = (t: Date, body: 'sun' | 'moon') => sampleBody(body, t, point.lat, point.lon);
    if (!target.horizonGated) {
      return enumerateVantageWindows({
        point,
        landmark: target.landmark,
        bodyAt,
        start: now,
        end,
        stepMinutes: 5,
        refinePeaks: true,
      }).map((w) => {
        // No building or horizon test for this target, so a disc on the horizon is flagged.
        const alt = bodyAt(w.peak, w.body).alt;
        return isLowPass(alt) ? { ...w, lowAltitudeDeg: alt } : w;
      });
    }
    return enumerateHorizonGatedWindows({
      point,
      landmark: target.landmark,
      map: grids!,
      bodyAt,
      start: now,
      end,
      stepMinutes: 5,
      refinePeaks: true,
      enabled: true, // the panel already gated on horizonPreviewOn()
    }).map((w) => ({
      body: w.body,
      peak: w.peak,
      coveredFraction: w.coveredFraction,
      band: columnBandAt(w.peakAltitudeDeg, point, target.landmark),
      horizon: !w.horizonConfident ? 'unsicher' : w.clearsHorizon ? 'frei' : 'verdeckt',
    }));
  };

  const run = (): void => {
    setState('running');
    setWeather({ status: 'idle' });
    setTerrainError(null);
    const epoch = ++runSeq.current;
    const terrain = target.horizonGated ? loadHeightmapStack() : Promise.resolve(null);
    terrain.then(
      (grids) => {
        if (runSeq.current !== epoch) return;
        // Two rAFs so the "running" state paints before the synchronous sweep blocks.
        requestAnimationFrame(() => requestAnimationFrame(() => compute(epoch, grids)));
      },
      (err: unknown) => {
        if (runSeq.current !== epoch) return;
        setTerrainError(err instanceof Error ? err.message : String(err));
        setState('idle');
      },
    );
  };

  const compute = (epoch: number, grids: Heightmap[] | null): void => {
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + WINDOW_MONTHS);
    const found = sweep(now, end, grids);
    setWindows(found);
    setSweptAt(now);
    setState('done');

    // The geometric list is the answer; the weather only annotates it. Async so a
    // dead network costs the calendar nothing.
    setWeather({ status: 'loading' });
    loadForecast(point.lat, point.lon)
      .then((forecast) => {
        if (runSeq.current !== epoch) return;
        const assessments = new Map<string, WeatherAssessment>();
        for (const w of found) {
          const a = assessWindowWeather(forecast, w.peak);
          if (a) assessments.set(w.peak.toISOString(), a);
        }
        setWeather({ status: 'ok', assessments });
      })
      .catch(() => {
        if (runSeq.current === epoch) setWeather({ status: 'error' });
      });
  };

  // A row whose disc is behind the terrain, or so low that the skyline probably hides it, is
  // listed (honestly) but is not "next".
  const next = windows.find((w) => w.horizon !== 'verdeckt' && w.lowAltitudeDeg === undefined);
  const lowCount = windows.filter((w) => w.lowAltitudeDeg !== undefined).length;
  const sunCount = windows.filter((w) => w.body === 'sun').length;
  const moonCount = windows.filter((w) => w.body === 'moon').length;

  return (
    <section className="pv-panel" data-testid="vantage-calendar">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">05</span>Dein Standort
        </h2>
        <span className="pv-panel__meta">
          {state === 'running' ? 'scanne…' : state === 'done' ? `${windows.length} Fenster` : 'bereit'}
        </span>
      </header>

      <div className="pv-readout" style={{ marginTop: 0 }}>
        {horizonOn && (
          <div className="pv-readout__row">
            <dt className="pv-label">Ziel</dt>
            <dd className="pv-value">
              <select
                aria-label="Ziel und Standort"
                data-testid="vantage-target"
                value={targetId}
                onChange={(e) => {
                  const t = TARGETS.find((x) => x.id === e.target.value) ?? TARGETS[0]!;
                  setTargetId(t.id);
                  setPointId(t.vantage.points[0]!.id);
                  reset();
                }}
              >
                {TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        )}
        <div className="pv-readout__row">
          <dt className="pv-label">Stehpunkt</dt>
          <dd className="pv-value">
            <select
              aria-label={`Stehpunkt: ${target.vantage.name}`}
              value={pointId}
              onChange={(e) => {
                setPointId(e.target.value);
                reset();
              }}
            >
              {target.vantage.points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {(p.distanceToLandmarkM / 1000).toFixed(2)} km
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">{target.bearingLabel}</dt>
          <dd className="pv-value">{point.bearingToLandmarkDeg.toFixed(2)}°</dd>
        </div>
      </div>

      <div className="pv-btn-row">
        <button type="button" onClick={run} disabled={state === 'running'} className="pv-btn pv-btn--primary">
          {state === 'running' ? 'Scanne 12 Monate…' : '12 Monate rechnen'}
        </button>
      </div>

      {terrainError && (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">Geländedaten nicht geladen.</strong> Ohne
          Horizont kann die Säule nicht ehrlich gerechnet werden ({terrainError}).
        </div>
      )}

      {state === 'done' && (
        <>
          {next && sweptAt && (
            <div className="pv-msg" role="status">
              <strong className="pv-msg__title">Nächster Termin</strong>
              {formatWhen(next.peak)} {berlinZoneName(next.peak)} · {BODY_LABEL[next.body]} · {BAND_LABEL[next.band]} ·{' '}
              {formatIn(next.peak, sweptAt)}
              {assessmentFor(next) && ` · ${formatAssessment(assessmentFor(next)!)}`}
            </div>
          )}

          <p className="pv-list__note" data-testid="vantage-zone-note">
            Alle Uhrzeiten in Berliner Zeit (MEZ/MESZ), egal wo dein Gerät steht.
          </p>

          <ul className="pv-list">
            {windows.map((w, i) => {
              const a = assessmentFor(w);
              // Offsets under half an hour are inside the forecast's own grain.
              const offsetNote =
                a && a.verdict === 'grenzwertig' && a.sampleOffsetHours >= 0.5
                  ? ` (±${Math.round(a.sampleOffsetHours * 60)} min)`
                  : '';
              const active = w.peak.getTime() === dt.getTime();
              return (
                <li key={`${w.body}-${w.peak.toISOString()}`}>
                  <button
                    type="button"
                    className={`pv-list__item${w.lowAltitudeDeg !== undefined ? ' pv-list__item--low' : ''}`}
                    aria-current={active}
                    onClick={() => {
                      // Same contract as SolverSearch's results: scrub the clock to the
                      // instant and show the actual composition in the preview.
                      dateTime.set(w.peak);
                      viewMode.set('preview');
                    }}
                  >
                    <span className="pv-list__ord">{String(i + 1).padStart(2, '0')}</span>
                    {formatWhen(w.peak)}
                    <span className="pv-list__meta">
                      {BODY_LABEL[w.body]} · {BAND_LABEL[w.band]} · {Math.round(w.coveredFraction * 100)} %
                      {w.body === 'moon' &&
                        ` · ${Math.round(moonLighting(w.peak, point.lat, point.lon).fraction * 100)} % beleuchtet`}
                      {w.lowAltitudeDeg !== undefined && (
                        <span className="pv-list__low" data-testid="vantage-low">{lowPassNote(w.lowAltitudeDeg)}</span>
                      )}
                      {w.horizon === 'verdeckt' && ' · hinter dem Horizont'}
                      {w.horizon === 'unsicher' && ' · Horizont unsicher'}
                      {a && (
                        <span className={`pv-wx pv-wx--${a.verdict}`}>
                          {formatAssessment(a)}
                          {offsetNote}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {target.horizonGated ? (
            <div className="pv-msg" role="status">
              <strong className="pv-msg__title">Ehrlich gelesen</strong>
              {`${windows.filter((w) => w.body === 'sun').length} Sonnenfenster, ${windows.filter((w) => w.body === 'moon').length} Mondfenster; ${windows.filter((w) => w.horizon === 'frei').length} davon über dem Horizont.`}{' '}
              Horizont aus DGM1 bis 10 km hinter der Säule: nacktes Gelände, ohne Bäume und
              Häuser — die Bäume am Tiergarten können tiefe Scheiben trotzdem verdecken.
            </div>
          ) : (
          <div className="pv-msg" role="status">
            <strong className="pv-msg__title">Ehrlich gelesen</strong>
            {sunCount === 0
              ? 'In den nächsten 12 Monaten geht die Sonne auf dieser Linie nie hinter dem Turm unter — die Geometrie erlaubt es in diesem Zeitraum nicht.'
              : `${sunCount} Sonnenfenster, ${moonCount} Mondfenster. Wo keine Zeile steht, passiert es nicht — das ist keine Lücke, sondern das Ergebnis.`}
            {lowCount > 0 &&
              ` ${lowCount} davon stehen tief am Horizont (Scheibenmitte unter ${formatAltitudeDe(LOW_PASS_CENTRE_DEG)}) und sind wahrscheinlich von Häusern verdeckt — die Liste prüft nur den Turm, keine Gebäude. Sie stehen blass in der Liste und zählen nicht als nächster Termin.`}
            {' '}Sonnen- und Mondzeiten sind gleich genau, meist auf 20 Sekunden — wenn du auf dem gewählten Punkt stehst: ein Meter zur Seite sind 3 Sekunden.
          </div>
          )}

          {weather.status === 'loading' && (
            <div className="pv-msg" role="status">
              Frage das Wetter für die nächsten 3 Tage… (Open-Meteo, stündliche Wolkenwerte)
            </div>
          )}
          {weather.status === 'error' && (
            <div className="pv-msg pv-msg--warn" role="status">
              <strong className="pv-msg__title">Wetter jetzt nicht erreichbar.</strong> Die
              Kalender-Zeiten stehen trotzdem — ob der Himmel mitspielt, musst du gerade
              selbst nachschauen.
            </div>
          )}
          {weather.status === 'ok' && (() => {
            const assessed = windows.filter((w) => weather.assessments.has(w.peak.toISOString()));
            const promising = assessed.filter((w) => weather.assessments.get(w.peak.toISOString())!.verdict !== 'bedeckt');
            return (
              <div className="pv-msg" role="status">
                <strong className="pv-msg__title">Nächste 3 Tage</strong>
                {assessed.length === 0
                  ? 'Kein Fenster in den nächsten 3 Tagen — wo keins steht, entscheidet auch das Wetter nicht. Die Liste oben bleibt die Zukunft.'
                  : `${assessed.length} der Fenster liegen in den nächsten 3 Tagen, ${promising.length} davon mit brauchbarem Himmel (unter 65 % Wolken). Die Wolkenangabe steht an der Zeile; ein Modell bleibt ein Modell.`}
              </div>
            );
          })()}

          {point.needsSiteCheck && target.horizonGated && (
            <div className="pv-msg" role="note">
              Stehpunkte auf dem Mittelstreifen der Straße des 17. Juni, Bodenhöhe aus
              DGM1 — vor Ort noch nicht geprüft.
            </div>
          )}
          {point.needsSiteCheck && !target.horizonGated && (
            <div className="pv-msg" role="note">
              Deckhöhe an dieser Stelle noch nicht verifiziert (Mid-Span-Wert 48,2 m angenommen) —
              das verschiebt Band-Grenzen um Zentimeter, nicht um Fenster.
            </div>
          )}
        </>
      )}
    </section>
  );
}
