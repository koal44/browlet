import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test_new/unit/**/*.test.ts'],
  },
});
