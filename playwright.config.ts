import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: /.*\.test\.ts/,
  reporter: 'list',

  projects: [
    {
      name: 'browser',
      testDir: 'test/browser',
      workers: 8,
    },
    {
      name: 'perf',
      testDir: 'test/perf',
      workers: 1,
      timeout: 120_000,
    },
  ],
});
