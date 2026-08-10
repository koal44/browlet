import { defineConfig } from '@playwright/test';

stopAnnoyingColorWarning();

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

function stopAnnoyingColorWarning(): void {
  const noColor = process.env.NO_COLOR;
  if (noColor === undefined) return;

  // Playwright forces color in workers, which makes Node warn when NO_COLOR is inherited.
  if (noColor !== '') process.env.FORCE_COLOR ??= '0';
  delete process.env.NO_COLOR;
}
