// Інтеграційний тест міграції 01_create_card (T1) проти РЕАЛЬНОЇ Neon-бази.
// Окремий від npm test (vitest run) навмисно -- домен (T6-T9) лишається швидким і без
// мережі; тут перевіряється сама схема, яку жоден unit-тест перевірити не може.
//
// БЕЗПЕЧНО без транзакції: перевірений тут INSERT свідомо провалюється на NOT NULL --
// нічого не записується в базу, відкочувати нема що.
//
// Запуск: npm run test:integration (env читається програмно, без CLI-прапорців --
// process.loadEnvFile працює однаково і в vitest, і напряму в node).

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from 'pg';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. викликач сам прокинув --env-file) -- ігноруємо
  }
});

describe('migration 01_create_card (life-area-card T1) — проти реальної Neon', () => {
  it('card.name NOT NULL реально забороняє порожнє значення на рівні БД', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query('INSERT INTO card (id, owner_user_id, name) VALUES (gen_random_uuid(), gen_random_uuid(), $1)', [
          null,
        ]),
      ).rejects.toThrow(/null value in column "name"/);
    } finally {
      await client.end();
    }
  });
});

describe('migration 01_create_app_user (agent T1) — проти реальної Neon', () => {
  it('app_user.google_sub UNIQUE реально відхиляє дублікат на рівні БД', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const googleSub = `test-google-sub-${crypto.randomUUID()}`;
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES (gen_random_uuid(), $1, $2)', [
        googleSub,
        'first@example.test',
      ]);
      try {
        await expect(
          client.query('INSERT INTO app_user (id, google_sub, email) VALUES (gen_random_uuid(), $1, $2)', [
            googleSub,
            'second@example.test',
          ]),
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        // прибираємо тестовий рядок -- єдиний тест, що щось реально пише
        await client.query('DELETE FROM app_user WHERE google_sub = $1', [googleSub]);
      }
    } finally {
      await client.end();
    }
  });
});
