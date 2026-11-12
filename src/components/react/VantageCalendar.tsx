/**
 * VantageCalendar — the bridge's alignment calendar, at real data (panel 05).
 *
 * THE PRODUCT MOMENT this component exists for: the photographer picks their standing
 * point on the Lichtenberger Brücke and reads the year's honest list — "11. Apr, 19:1x,
 * Sonnenscheibe auf der Spitze" — INCLUDING the entry that is deliberately absent:
 * mid-May, when the sun crosses the tower bearing far above the spire, there is no row,
 * and the caption says so in words.
 *
 * Computation runs on demand (button press), on the main thread: a full-year
 * enumerateVantageWindows sweep measures ~0.3 s in the unit suite, far below the
 * worker threshold SolverSearch needs for its per-instant area solves. If this ever
 * grows a per-minute refinement, move it into a worker like SolverSearch's.
 *
 * Honesty rules carried over from the sketch panel: vantage names are the real OSM
 * standing points; needsSiteCheck points say so; the moon disclaimer states suncalc's
 * lunar accuracy limit instead of promising dates the ephemeris cannot back.
 */
import { useMemo, useState } from 'react';
import { LICHTENBERGER_BRUECKE } from '../../lib/vantages.js';
import { enumerateVantageWindows, type VantageWindow } from '../../lib/vantageWindows.js';
import { FERNSEHTURM } from '../../lib/landmarks.js';
import { sampleBody } from '../../lib/bodyPosition.js';
import { dateTime, viewMode } from '../../store.js';

const WINDOW_MONTHS = 12;

const BAND_LABEL: Record<VantageWindow['band'], string> = {
  spire: 'Spitze',
  sphere: 'Kugel',
  shaft: 'Schaft',
  base: 'Fuß',
};

const BODY_LABEL: Record<VantageWindow['body'], string> = {
  sun: 'Sonne',
  moon: 'Mond',
};

/** "11. Apr, 19:12" in the observer's own timezone — a photo plan is a local plan. */
function formatWhen(d: Date): string {
  return (
    d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) +
    ', ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  );
}

export default function VantageCalendar() {
  const [pointId, setPointId] = useState(LICHTENBERGER_BRUECKE.points[0]!.id);
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [windows, setWindows] = useState<VantageWindow[]>([]);

  const point = useMemo(
    // The registry is a non-empty constant; the ?? guards only the type, not reality.
    () => LICHTENBERGER_BRUECKE.points.find((p) => p.id === pointId) ?? LICHTENBERGER_BRUECKE.points[0]!,
    [pointId],
  );

  const run = (): void => {
    setState('running');
    // Two rAFs so the "running" state paints before the synchronous sweep blocks.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const now = new Date();
        const end = new Date(now);
        end.setMonth(end.getMonth() + WINDOW_MONTHS);
        const found = enumerateVantageWindows({
          point,
          landmark: FERNSEHTURM,
          bodyAt: (t, body) => sampleBody(body, t, point.lat, point.lon),
          start: now,
          end,
          stepMinutes: 5,
        });
        setWindows(found);
        setState('done');
      }),
    );
  };

  const sunRows = windows.filter((w) => w.body === 'sun');
  const moonRows = windows.filter((w) => w.body === 'moon');

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
        <div className="pv-readout__row">
          <dt className="pv-label">Stehpunkt</dt>
          <dd className="pv-value">
            <select
              aria-label="Stehpunkt auf der Brücke"
              value={pointId}
              onChange={(e) => {
                setPointId(e.target.value);
                setState('idle');
                setWindows([]);
              }}
            >
              {LICHTENBERGER_BRUECKE.points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.bearingToLandmarkDeg.toFixed(2)}° · {(p.distanceToLandmarkM / 1000).toFixed(2)} km
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Peilung zum Turm</dt>
          <dd className="pv-value">{point.bearingToLandmarkDeg.toFixed(2)}°</dd>
        </div>
      </div>

      {point.needsSiteCheck && (
        <div className="pv-msg" role="note">
          Deckhöhe an dieser Stelle noch nicht verifiziert (Mid-Span-Wert 48,2 m angenommen) —
          das verschiebt Band-Grenzen um Zentimeter, nicht um Fenster.
        </div>
      )}

      <div className="pv-btn-row">
        <button type="button" onClick={run} disabled={state === 'running'} className="pv-btn pv-btn--primary">
          {state === 'running' ? 'Scanne 12 Monate…' : 'Kalender für 12 Monate rechnen'}
        </button>
      </div>

      {state === 'done' && (
        <>
          <ul className="pv-list">
            {windows.map((w, i) => (
              <li key={`${w.body}-${w.peak.toISOString()}`}>
                <button
                  type="button"
                  className="pv-list__item"
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
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="pv-msg" role="status">
            <strong className="pv-msg__title">Ehrlich gelesen</strong>
            {sunRows.length === 0
              ? 'In den nächsten 12 Monaten geht die Sonne auf dieser Linie nie hinter dem Turm unter — die Geometrie erlaubt es in diesem Zeitraum nicht.'
              : `${sunRows.length} Sonnenfenster${moonRows.length ? `, ${moonRows.length} Mondfenster` : ''}. Wo keine Zeile steht, passiert es nicht — das ist keine Lücke, sondern das Ergebnis.`}
            {' '}Mond-Tage sind auf ±2 Tage genau (Mondtheorie von suncalc); die Spitzen-Treffer im Frühjahr/Spätsommer sind die verlässlichsten.
          </div>
        </>
      )}
    </section>
  );
}
