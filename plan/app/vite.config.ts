/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Налаштування збірки та локального запуску.
// PWA-маніфест і Tailwind з'являться пізніше — задачі S1 і S4 у docs/features/_scaffold/tasks.json.

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // *.integration.test.ts потребує мережі й реальної БД (ADR-0006) -- окрема команда
    // npm run test:integration, не звичайний npm test (домен лишається швидким).
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
