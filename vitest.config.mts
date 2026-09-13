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
            'test/lint/**/*.test.mjs',
            'test/selectlet/unit/**/*.test.ts',
            'test/infra/**/*.test.ts',
            'test/js-engine/**/*.test.ts',
            'test/mime/**/*.test.ts',
            'test/encoding/**/*.test.ts',
            'test/http/**/*.test.ts',
            'test/file/**/*.test.ts',
            'test/fetch/**/*.test.ts',
            'test/url/**/*.test.ts',
            'test/web-idl/**/*.test.ts',
            'test/stylelet/unit/**/*.test.ts',
            'test/browlet/**/*.test.ts',
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
