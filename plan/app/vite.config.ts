/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Налаштування збірки та локального запуску.
// PWA-маніфест і Tailwind з'являться пізніше — задачі S1 і S4 у plan/features/_scaffold/tasks.json.

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
