import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['node_modules/', 'dist/', 'tmp/', '**/*.config.*', '**/*.d.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tmp/', '**/*.config.*', '**/*.d.ts'],
    },
  },
});
