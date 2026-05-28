import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose'],
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'node',
          include: ['test/jsdom/**/*.test.ts', 'test/browser/**/*.test.ts'],
          exclude: ['test/jsdom/perf/**/*.test.ts'],
          setupFiles: ['./test/jsdom/harness/setup.ts'],
        },
      },
      {
        test: {
          name: 'jsdom-perf',
          environment: 'node',
          include: ['test/jsdom/perf/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
