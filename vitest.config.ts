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
            'test/url/unit/**/*.test.ts',
            'test/web-idl/unit/**/*.test.ts',
            'test/stylelet/unit/**/*.test.ts',
            'test/domlet/unit/**/*.test.ts',
            'test/browlet/unit/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'browlet-host',
          environment: 'node',
          include: ['test/selectlet/scenarios/**/*.test.ts'],
          setupFiles: ['./test/scenario/browlet/setup.ts'],
        },
      },
      {
        test: {
          name: 'wpt',
          environment: 'node',
          include: ['test/wpt/browlet.test.ts'],
          testTimeout: 70_000,
        },
      },
    ],
  },
});
