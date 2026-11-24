/**
 * The real `src/miniature/clock.js` on the clock-change days, with a stand-in page
 * (audit defect 1). The arithmetic is tested in clockChange.test.ts; this drives the module
 * the pages load: pick a shot with `setMinute`, read the scene's instant with `instant()`.
 * Expected instants are written out in UTC from the EU rule (change at 01:00 UTC).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/miniature/lighting.js', () => ({ updateSun: () => {} }));
vi.mock('../../src/miniature/plan.js', () => ({ PHASE_COLOURS: {}, updateDay: () => {} }));
vi.mock('../../src/miniature/daylist.js', () => ({ snapMinute: () => null }));
vi.mock('../../src/miniature/state.js', () => ({ invalidate: () => {} }));
vi.mock('../../src/miniature/config.js', () => ({ params: new URLSearchParams('date=2027-03-28&time=960') }));

type Listener = () => void;
const elements = new Map<string, ReturnType<typeof element>>();
function element() {
  const listeners = new Map<string, Listener[]>();
  return {
    value: '',
    min: '0',
    max: '1439',
    hidden: false,
    textContent: '',
    dataset: {} as Record<string, string>,
    style: { setProperty: () => {} },
    classList: { toggle: () => {} },
    setAttribute: () => {},
    select: () => {},
    blur: () => {},
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    fire: (type: string) => (listeners.get(type) ?? []).forEach((fn) => fn()),
  };
}
vi.stubGlobal('document', {
  getElementById: (id: string) => elements.get(id) ?? elements.set(id, element()).get(id)!,
  body: element(),
  activeElement: null,
});
vi.stubGlobal('MutationObserver', class { observe() {} });

let clock: typeof import('../../src/miniature/clock.js');
const utc = (s: string) => Date.parse(s);
const slider = () => elements.get('time')!;

describe('clock.js on the days the clocks change', () => {
  beforeAll(async () => {
    clock = await import('../../src/miniature/clock.js');
  });

  it('28 March 2027: picking the 19:35 shot shows 19:35 and puts the scene at that instant', () => {
    clock.setDay('2027-03-28');
    const shot = utc('2027-03-28T17:35:00Z');
    clock.setMinute(shot);
    expect(slider().value).toBe(String(19 * 60 + 35));
    expect(clock.instant().getTime()).toBe(shot);
    expect(clock.dayEnd() - clock.dayStart()).toBe(23 * 3_600_000);
  });

  it('28 March 2027: a time typed or slid into the missing hour moves to what the clock reads', () => {
    clock.setDay('2027-03-28');
    slider().value = String(2 * 60 + 30);
    slider().fire('input');
    expect(slider().value).toBe(String(3 * 60 + 30));
    expect(clock.instant().getTime()).toBe(utc('2027-03-28T01:30:00Z'));
    elements.get('clock')!.value = '02:15';
    elements.get('clock')!.fire('change');
    expect(slider().value).toBe(String(3 * 60 + 15));
    expect(clock.instant().getTime()).toBe(utc('2027-03-28T01:15:00Z'));
    // Either side of it nothing moves.
    slider().value = String(1 * 60 + 59);
    slider().fire('input');
    expect(clock.instant().getTime()).toBe(utc('2027-03-28T00:59:00Z'));
  });

  it('31 October 2027: picking the 16:40 shot shows 16:40 and puts the scene at that instant', () => {
    clock.setDay('2027-10-31');
    const shot = utc('2027-10-31T15:40:00Z');
    clock.setMinute(shot);
    expect(slider().value).toBe(String(16 * 60 + 40));
    expect(clock.instant().getTime()).toBe(shot);
    expect(clock.dayEnd() - clock.dayStart()).toBe(25 * 3_600_000);
  });

  it('31 October 2027: a shot in the second 02:30 stays in the second one until the time is moved', () => {
    clock.setDay('2027-10-31');
    const first = utc('2027-10-31T00:30:00Z');
    const second = utc('2027-10-31T01:30:00Z');
    clock.setMinute(second);
    expect(slider().value).toBe('150');
    expect(clock.instant().getTime()).toBe(second);
    clock.setMinute(first);
    expect(slider().value).toBe('150');
    expect(clock.instant().getTime()).toBe(first);
    // Moved by hand, the doubled hour reads as its first occurrence; another day forgets the pick.
    clock.setMinute(second);
    slider().value = '151';
    expect(clock.instant().getTime()).toBe(first + 60_000);
    clock.setMinute(second);
    clock.setDay('2027-11-01');
    expect(clock.instant().getTime()).toBe(utc('2027-11-01T01:30:00Z'));
  });

  it('an ordinary day is unchanged: 21 June 2027, 21:33 CEST', () => {
    clock.setDay('2027-06-21');
    clock.setMinute(utc('2027-06-21T19:33:00Z'));
    expect(slider().value).toBe(String(21 * 60 + 33));
    expect(clock.instant().getTime()).toBe(utc('2027-06-21T19:33:00Z'));
  });
});
