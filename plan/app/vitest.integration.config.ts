/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Окремий конфіг лише для *.integration.test.ts (реальна мережа, реальна Neon-БД,
// ADR-0006). npm test (vite.config.ts) свідомо виключає ці файли -- швидкий домен
// без мережі лишається за замовчуванням; ця команда -- окремий, повільніший прогін.

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.integration.test.ts'],
  },
});
