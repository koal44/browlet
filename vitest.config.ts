import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose'],
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'test/selectlet/unit/**/*.test.ts',
            'test/shared/unit/**/*.test.ts',
            'test/stylelet/unit/**/*.test.ts',
            'test/domlet/unit/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'node',
          include: [
            'test/selectlet/jsdom/**/*.test.ts',
            'test/selectlet/browser/**/*.test.ts',
          ],
          exclude: ['test/selectlet/jsdom/perf/**/*.test.ts'],
          setupFiles: ['./test/selectlet/jsdom/harness/setup.ts'],
        },
      },
      {
        test: {
          name: 'domlet-host',
          environment: 'node',
          include: ['test/selectlet/browser/**/*.test.ts'],
          setupFiles: ['./test/selectlet/domlet/harness/setup.ts'],
        },
      },
      {
        test: {
          name: 'jsdom-perf',
          environment: 'node',
          include: ['test/selectlet/jsdom/perf/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
