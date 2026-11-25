import { defineConfig } from 'vitest/config';

/** For crawl.test.ts only: `npx vitest run -c scripts/adversarial/vitest.config.ts` from the repository's root. */
export default defineConfig({
  test: {
    root: '.',
    include: ['scripts/adversarial/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    silent: false,
  },
});
