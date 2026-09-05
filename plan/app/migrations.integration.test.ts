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

describe('migration 02_create_metric_block (T2) — проти реальної Neon', () => {
  it('видалення card каскадно видаляє її metric_block (FK ON DELETE CASCADE)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // card.owner_user_id має FK на app_user (T38) -- потрібен реальний рядок,
      // "просто випадковий UUID" тепер відхилиться fk_card_owner_user.
      const userId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const blockId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        userId,
        `test-t2-${userId}`,
        't2@example.test',
      ]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
        cardId,
        userId,
        'T2 test card',
      ]);
      await client.query('INSERT INTO metric_block (id, card_id, label, unit) VALUES ($1, $2, $3, $4)', [
        blockId,
        cardId,
        'Test block',
        'items',
      ]);

      await client.query('DELETE FROM card WHERE id = $1', [cardId]);

      const { rows } = await client.query('SELECT id FROM metric_block WHERE id = $1', [blockId]);
      expect(rows).toHaveLength(0);

      await client.query('DELETE FROM app_user WHERE id = $1', [userId]);
    } finally {
      await client.end();
    }
  });
});

describe('migration 04_create_card_lifecycle_event (T4) — проти реальної Neon', () => {
  it('індекс idx_lifecycle_card_time на (card_id, occurred_at) реально існує', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'card_lifecycle_event' AND indexname = 'idx_lifecycle_card_time'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/\(card_id, occurred_at\)/);
    } finally {
      await client.end();
    }
  });
});

describe('migration 07_add_owner_fk (T38) — проти реальної Neon', () => {
  it('видалення app_user каскадно видаляє його card (вмикає видалення акаунта, agent AC-17/D-89)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const userId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        userId,
        `test-t38-${userId}`,
        't38@example.test',
      ]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
        cardId,
        userId,
        'T38 test card',
      ]);

      await client.query('DELETE FROM app_user WHERE id = $1', [userId]);

      const { rows } = await client.query('SELECT id FROM card WHERE id = $1', [cardId]);
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
