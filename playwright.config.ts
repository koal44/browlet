import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: /.*\.test\.ts/,
  reporter: 'list',

  projects: [
    {
      name: 'browser',
      testDir: 'test_new/browser',
      workers: 8,
    },
    {
      name: 'perf',
      testDir: 'test_new/perf',
      workers: 1,
      timeout: 120_000,
    },
  ],
});
