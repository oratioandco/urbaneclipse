import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

function listSource(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSource(p, acc);
    } else if (/\.(ts|tsx|astro)$/.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe('SSR graph guard (Constitution Principle I/IV)', () => {
  // Cesium touches window/document/WebWorker at import time and MUST stay out of any
  // server-rendered module graph. Only src/cesium/** and the client:only island may import it.
  it('no file under src/pages or src/layouts imports "cesium"', () => {
    const guarded = [...listSource(join(SRC, 'pages')), ...listSource(join(SRC, 'layouts'))];
    const offenders = guarded.filter((f) => /from\s+['"]cesium['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
