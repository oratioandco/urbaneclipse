import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * T058 — localStorage preference persistence contract.
 *
 * `src/store.ts` rehydrates from localStorage as a MODULE-LEVEL side effect at import
 * time, so each scenario needs a fresh module graph (vi.resetModules + dynamic
 * import) with a differently-shaped `globalThis.localStorage` stubbed in *before* the
 * import happens.
 */

function makeFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const STORAGE_KEY = 'plaster-void:prefs:v1';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('store persistence — guards (T058)', () => {
  it('does not crash importing the store when localStorage is absent (SSR/worker)', async () => {
    // No stub at all: in this node test environment localStorage is undefined already.
    vi.resetModules();
    await expect(import('../../src/store')).resolves.toBeDefined();
  });

  it('does not crash on read/write when localStorage throws (private mode / quota exceeded)', async () => {
    const throwing: Storage = {
      getItem() {
        throw new Error('boom-get');
      },
      setItem() {
        throw new Error('boom-set');
      },
      removeItem() {},
      clear() {},
      key() {
        return null;
      },
      length: 0,
    } as Storage;
    vi.stubGlobal('localStorage', throwing);
    vi.resetModules();

    const store = await import('../../src/store');
    expect(() => store.observerHeight.set(42)).not.toThrow();
    expect(() => store.cameraProfile.set({ sensorWidth: 36, focalLength: 200, zoom: 1 })).not.toThrow();
  });
});

describe('store persistence — rehydrate validation (T058)', () => {
  it('rehydrates dateTime/observerHeight/targetHeight/cameraProfile from a valid payload', async () => {
    const stored = {
      dateTime: new Date('2026-08-15T22:30:00Z').getTime(),
      observerHeight: 3.2,
      targetHeight: 250,
      cameraProfile: { sensorWidth: 23.6, focalLength: 400, zoom: 1.5 },
    };
    vi.stubGlobal('localStorage', makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(stored) }));
    vi.resetModules();

    const store = await import('../../src/store');
    expect(store.dateTime.get().getTime()).toBe(stored.dateTime);
    expect(store.observerHeight.get()).toBe(3.2);
    expect(store.targetHeight.get()).toBe(250);
    expect(store.cameraProfile.get()).toEqual(stored.cameraProfile);
  });

  it('rejects malformed JSON and falls back to the documented defaults', async () => {
    vi.stubGlobal('localStorage', makeFakeStorage({ [STORAGE_KEY]: '{not-valid-json' }));
    vi.resetModules();

    const store = await import('../../src/store');
    expect(store.observerHeight.get()).toBe(1.5);
    expect(store.targetHeight.get()).toBe(210);
    expect(store.cameraProfile.get()).toEqual({ sensorWidth: 36, focalLength: 600, zoom: 1 });
  });

  it('rejects a non-object payload and falls back to defaults', async () => {
    vi.stubGlobal('localStorage', makeFakeStorage({ [STORAGE_KEY]: JSON.stringify('just a string') }));
    vi.resetModules();

    const store = await import('../../src/store');
    expect(store.observerHeight.get()).toBe(1.5);
  });

  it('rejects out-of-range / NaN / wrong-type fields individually, keeping valid fields', async () => {
    const stored = {
      dateTime: 'not-a-number', // wrong type
      observerHeight: -5, // out of range (must be > 0)
      targetHeight: Number.NaN, // NaN
      cameraProfile: { sensorWidth: 36, focalLength: 600, zoom: 1 }, // valid
    };
    vi.stubGlobal('localStorage', makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(stored) }));
    vi.resetModules();

    const store = await import('../../src/store');
    // Rejected fields fall back to the module defaults.
    expect(store.observerHeight.get()).toBe(1.5);
    expect(store.targetHeight.get()).toBe(210);
    // dateTime falls back to "now" — assert it's a valid Date, not the bogus string.
    expect(store.dateTime.get()).toBeInstanceOf(Date);
    expect(Number.isNaN(store.dateTime.get().getTime())).toBe(false);
    // The one valid field still rehydrates.
    expect(store.cameraProfile.get()).toEqual(stored.cameraProfile);
  });

  it('rejects an out-of-range cameraProfile (zero/negative focalLength)', async () => {
    const stored = { cameraProfile: { sensorWidth: 36, focalLength: 0, zoom: 1 } };
    vi.stubGlobal('localStorage', makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(stored) }));
    vi.resetModules();

    const store = await import('../../src/store');
    expect(store.cameraProfile.get()).toEqual({ sensorWidth: 36, focalLength: 600, zoom: 1 });
  });
});

describe('store persistence — write-through (T058)', () => {
  it('persists on write; a fresh module import picks up the new values', async () => {
    const fake = makeFakeStorage();
    vi.stubGlobal('localStorage', fake);
    vi.resetModules();

    const store1 = await import('../../src/store');
    store1.observerHeight.set(7.5);
    store1.targetHeight.set(300);
    store1.cameraProfile.set({ sensorWidth: 17.3, focalLength: 800, zoom: 2 });

    vi.resetModules();
    // Re-stub the SAME fake storage instance (not a new empty one) so the second
    // import reads what the first import wrote.
    vi.stubGlobal('localStorage', fake);
    const store2 = await import('../../src/store');

    expect(store2.observerHeight.get()).toBe(7.5);
    expect(store2.targetHeight.get()).toBe(300);
    expect(store2.cameraProfile.get()).toEqual({ sensorWidth: 17.3, focalLength: 800, zoom: 2 });
  });
});

describe('store persistence — does not break existing invariants (T058 regression guard)', () => {
  it('setDateTimeScrubbing is still rAF-coalesced with persistence wired in', async () => {
    vi.stubGlobal('localStorage', makeFakeStorage());
    vi.resetModules();
    const store = await import('../../src/store');

    let rafCb: (() => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const spy = vi.fn();
    const unsub = store.dateTime.listen(spy);

    store.setDateTimeScrubbing(new Date(5000));
    store.setDateTimeScrubbing(new Date(6000));
    expect(spy).not.toHaveBeenCalled();

    expect(rafCb).not.toBeNull();
    rafCb!();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.dateTime.get().getTime()).toBe(6000);

    unsub();
  });

  it('isOccluded stays read-only (commitOcclusion is the sole writer) with persistence wired in', async () => {
    vi.stubGlobal('localStorage', makeFakeStorage());
    vi.resetModules();
    const store = await import('../../src/store');

    store.commitOcclusion(true);
    expect(store.isOccluded.get()).toBe(true);
    // Read-only is enforced at the TYPE level (ReadableAtom export), not at runtime —
    // see src/store.ts's private-source pattern. commitOcclusion remains the sole
    // sanctioned mutation path exercised here.
    expect(typeof store.isOccluded.get).toBe('function');
  });
});
