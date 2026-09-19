/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Налаштування збірки та локального запуску.
// PWA-маніфест з'явиться пізніше — задача S1 у docs/features/_scaffold/tasks.json.
// Tailwind (S4) підключено 2026-09-13 -- src/app/theme.css.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Root .env (правило єдиного джерела) -- DATABASE_URL/JWT_SECRET лишаються
  // недоступні браузеру (Vite експонує лише VITE_-префіксовані змінні),
  // VITE_GOOGLE_CLIENT_ID (ADR-0006 "### Фронтенд (ISS-52)") читається звідти.
  envDir: '../../',
  // Dev-проксі на реальний Express (server/index.ts, T30, порт 3000) --
  // main.tsx стукає відносними шляхами ('/api/v1/...'), інакше Vite сам
  // "з'їдав" ці запити своїм SPA-фолбеком і повертав index.html замість
  // реальної відповіді сервера (ISS-54, знайдено живим тестуванням входу).
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // *.integration.test.ts потребує мережі й реальної БД (ADR-0006) -- окрема команда
    // npm run test:integration, не звичайний npm test (домен лишається швидким).
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
