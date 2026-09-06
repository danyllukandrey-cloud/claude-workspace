/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Налаштування збірки та локального запуску.
// PWA-маніфест і Tailwind з'являться пізніше — задачі S1 і S4 у docs/features/_scaffold/tasks.json.

export default defineConfig({
  plugins: [react()],
  // Root .env (правило єдиного джерела) -- DATABASE_URL/JWT_SECRET лишаються
  // недоступні браузеру (Vite експонує лише VITE_-префіксовані змінні),
  // VITE_GOOGLE_CLIENT_ID (ADR-0006 "### Фронтенд (ISS-52)") читається звідти.
  envDir: '../../',
  test: {
    environment: 'jsdom',
    globals: true,
    // *.integration.test.ts потребує мережі й реальної БД (ADR-0006) -- окрема команда
    // npm run test:integration, не звичайний npm test (домен лишається швидким).
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
