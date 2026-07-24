import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: /.*\.test\.ts/,
  timeout: 60_000,
  reporter: 'list',

  projects: [
    {
      name: 'selector',
      testDir: 'test/selectlet/browser',
      workers: 8,
    },
    {
      name: 'style',
      testDir: 'test/stylelet/browser',
      workers: 8,
    },
    {
      name: 'perf',
      testDir: 'test/selectlet/perf',
      workers: 1,
      timeout: 120_000,
    },
  ],
});
