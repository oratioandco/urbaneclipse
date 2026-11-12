import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessWindowWeather,
  formatAssessment,
  parseOpenMeteoHourly,
  verdictFromCover,
  type WeatherForecast,
} from '../../src/lib/shotWeather.js';

/**
 * The weather gate answers "can I actually MAKE this shot in the next 3 days?".
 * The verdict bands are the product decision under test; the parser is tested against
 * a REAL Open-Meteo payload recorded 2026-11-12 for the Lichtenberger Brücke
 * (52.5113, 13.4988), so shape drift in their schema breaks loudly here first.
 */

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'openmeteo_2026-11-12.json'), 'utf8'),
) as unknown;

describe('open-meteo payload decode', () => {
  it('parses the recorded real payload into 72 UTC-true hourly samples', () => {
    const forecast = parseOpenMeteoHourly(fixture);
    expect(forecast.times).toHaveLength(72);
    expect(forecast.cloudCoverPct).toHaveLength(72);
    expect(forecast.precipitationMm).toHaveLength(72);
    // unixtime epochs must decode to true UTC instants: first sample is 00:00 Berlin
    // = 23:00 UTC the previous day.
    expect(forecast.times[0]!.toISOString()).toBe('2026-11-11T23:00:00.000Z');
    // ascending
    for (let i = 1; i < forecast.times.length; i++) {
      expect(forecast.times[i]!.getTime()).toBeGreaterThan(forecast.times[i - 1]!.getTime());
    }
  });

  it('throws loudly on shape drift instead of mislabelling evenings', () => {
    expect(() => parseOpenMeteoHourly({ hourly: { time: [1, 2] } })).toThrow();
    expect(() => parseOpenMeteoHourly({})).toThrow();
  });
});

describe('verdict bands', () => {
  it("speaks the photographer's three words", () => {
    expect(verdictFromCover(0)).toBe('klar');
    expect(verdictFromCover(24.9)).toBe('klar');
    expect(verdictFromCover(25)).toBe('grenzwertig');
    expect(verdictFromCover(65)).toBe('grenzwertig');
    expect(verdictFromCover(65.1)).toBe('bedeckt');
    expect(verdictFromCover(100)).toBe('bedeckt');
  });
});

describe('assessWindowWeather', () => {
  // A synthetic 6-hour series: clear evening hole between two bank days.
  const forecast: WeatherForecast = {
    times: [
      15, 16, 17, 18, 19, 20, 21, 22,
    ].map((h) => new Date(Date.UTC(2027, 3, 8, h))),
    cloudCoverPct: [90, 90, 80, 40, 12, 15, 60, 95],
    precipitationMm: [0.4, 0.3, 0.1, 0, 0, 0, 0, 0.2],
  };

  it('matches the window instant to the nearest hourly sample', () => {
    // 19:40 sits 40 min past the 19:00 sample, 20 min before the 20:00 one → 20:00 wins.
    const a = assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 8, 19, 40)))!;
    expect(a.verdict).toBe('klar');
    expect(a.cloudCoverPct).toBe(15);
    expect(a.sampleOffsetHours).toBeCloseTo(20 / 60, 5);
  });

  it('returns null outside the forecast range — no borrowed skies', () => {
    expect(assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 9)))).toBeNull();
    expect(assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 8, 5)))).toBeNull();
  });

  it('formats the panel row', () => {
    const a = assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 8, 19)))!;
    expect(formatAssessment(a)).toBe('12 % Wolken — klar');
  });

  it('names the rain only when there is rain worth naming', () => {
    const drizzle = assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 8, 15)))!;
    expect(formatAssessment(drizzle)).toBe('90 % Wolken — bedeckt · 0.4 mm/h');
    const dry = assessWindowWeather(forecast, new Date(Date.UTC(2027, 3, 8, 17)))!;
    expect(formatAssessment(dry)).toBe('80 % Wolken — bedeckt');
  });
});
