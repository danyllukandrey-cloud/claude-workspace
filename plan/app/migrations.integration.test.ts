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
import type { Db } from './src/cards/life-area-card/infra/postgres-repo';
import {
  insertCard,
  findCardById,
  listCardsByOwner,
  listActiveCardsByOwner,
  listArchivedCardsByOwner,
  updateCard as updateCardRow,
  insertMetricBlock,
  listMetricBlocksByCard,
  updateMetricBlock,
  findMetricBlockByCardLabelUnit,
  insertEntry,
  listEntriesByMetricBlock,
  listEntriesByCard,
  listPendingEntriesByCard,
  updateEntryStatus,
  reassignEntriesToCard,
  insertLifecycleEvent,
  listLifecycleEventsByCard,
} from './src/cards/life-area-card/infra/postgres-repo';
import { createCard } from './src/cards/life-area-card/app/create-card';
import { updateCard } from './src/cards/life-area-card/app/update-card';
import { archiveCard } from './src/cards/life-area-card/app/archive-card';
import { restoreCard } from './src/cards/life-area-card/app/restore-card';
import { listCards } from './src/cards/life-area-card/app/list-cards';
import { createMetricBlock } from './src/cards/life-area-card/app/create-metric-block';
import { transferMetricBlock } from './src/cards/life-area-card/app/transfer-metric-block';
import { createEntry } from './src/cards/life-area-card/app/create-entry';
import { resolveEntry } from './src/cards/life-area-card/app/resolve-entry';
import { getCardWithProgress } from './src/cards/life-area-card/app/get-card';
import { closeActiveLayoutPositionForCard } from './src/structure/infra/postgres-repo';

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

describe('migration 03_create_entry (T3) — проти реальної Neon', () => {
  it('частковий індекс idx_entry_card_pending на pending-записи реально існує (AC-11)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'entry' AND indexname = 'idx_entry_card_pending'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/WHERE \(?status = 'pending'::text\)?/);
    } finally {
      await client.end();
    }
  });
});

describe('migration 06_add_card_restore (T32) — проти реальної Neon', () => {
  it('card_lifecycle_event.transition CHECK реально приймає \'restored\' (AC-17)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const userId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        userId,
        `test-t32-${userId}`,
        't32@example.test',
      ]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
        cardId,
        userId,
        'T32 test card',
      ]);

      await expect(
        client.query("INSERT INTO card_lifecycle_event (id, card_id, transition) VALUES ($1, $2, 'restored')", [
          eventId,
          cardId,
        ]),
      ).resolves.not.toThrow();

      await client.query('DELETE FROM app_user WHERE id = $1', [userId]);
    } finally {
      await client.end();
    }
  });

  it('частковий індекс idx_card_owner_archived реально існує (AC-18)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'card' AND indexname = 'idx_card_owner_archived'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/WHERE \(?status = 'archived'::text\)?/);
    } finally {
      await client.end();
    }
  });
});

describe('migration 05_add_card_status (T5) — проти реальної Neon', () => {
  it('частковий індекс WHERE status=active реально виключає архівовані картки зі списку активних', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const userId = crypto.randomUUID();
      const activeId = crypto.randomUUID();
      const archivedId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        userId,
        `test-t5-${userId}`,
        't5@example.test',
      ]);
      await client.query("INSERT INTO card (id, owner_user_id, name, status) VALUES ($1, $2, $3, 'active')", [
        activeId,
        userId,
        'T5 active card',
      ]);
      await client.query("INSERT INTO card (id, owner_user_id, name, status) VALUES ($1, $2, $3, 'archived')", [
        archivedId,
        userId,
        'T5 archived card',
      ]);

      const { rows } = await client.query("SELECT id FROM card WHERE owner_user_id = $1 AND status = 'active'", [
        userId,
      ]);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(activeId);
      expect(ids).not.toContain(archivedId);

      await client.query('DELETE FROM app_user WHERE id = $1', [userId]);
    } finally {
      await client.end();
    }
  });
});

describe('T10 — Postgres repo (life-area-card) — проти реальної Neon', () => {
  // Застосунок ходить пуловим підключенням (ADR-0006) -- на відміну від
  // тестів вище (мігратор/схема), які навмисно ходять непульованим DATABASE_URL.
  async function withUser<T>(client: Client, run: (db: Db, ownerUserId: string) => Promise<T>): Promise<T> {
    const ownerUserId = crypto.randomUUID();
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerUserId,
      `test-t10-${ownerUserId}`,
      't10@example.test',
    ]);
    try {
      return await run(client, ownerUserId);
    } finally {
      // каскадно прибирає card/metric_block/entry/card_lifecycle_event цього власника
      await client.query('DELETE FROM app_user WHERE id = $1', [ownerUserId]);
    }
  }

  it('card: запис і читання через репо (insertCard + findCardById)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const created = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T10 test card' });
        expect(created.name).toBe('T10 test card');
        expect(created.status).toBe('active');

        const found = await findCardById(db, ownerUserId, created.id);
        expect(found).not.toBeNull();
        expect(found?.id).toBe(created.id);
      });
    } finally {
      await client.end();
    }
  });

  it('metric_block: запис і читання через репо (insertMetricBlock + listMetricBlocksByCard, AC-09)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T10 metric_block card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Книги прочитано',
          unit: 'книги',
          targetCount: 12,
        });
        expect(block.targetCount).toBe(12);

        const blocks = await listMetricBlocksByCard(db, card.id);
        expect(blocks.map((b) => b.id)).toEqual([block.id]);
      });
    } finally {
      await client.end();
    }
  });

  it('entry: запис і читання через репо (усі 3 списки — metric_block/card/pending, AC-11/AC-13)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T10 entry card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Пробіжки',
          unit: 'км',
          targetCount: 100,
        });

        // Послідовно (не Promise.all) -- recorded_at мають реально відрізнятись,
        // інакше ORDER BY recorded_at DESC нема на чому перевірити.
        const first = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: card.id, amount: 5 });
        const second = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: card.id, amount: 3 });
        const pending = await insertEntry(db, {
          id: crypto.randomUUID(),
          metricBlockId: block.id,
          cardId: card.id,
          amount: 2,
          status: 'pending',
        });

        const byBlock = await listEntriesByMetricBlock(db, block.id);
        expect(byBlock.map((e) => e.id).sort()).toEqual([first.id, second.id, pending.id].sort());

        const byCard = await listEntriesByCard(db, card.id);
        expect(byCard.map((e) => e.id)).toEqual([pending.id, second.id, first.id]);

        const stillPending = await listPendingEntriesByCard(db, card.id);
        expect(stillPending.map((e) => e.id)).toEqual([pending.id]);
      });
    } finally {
      await client.end();
    }
  });

  it('card_lifecycle_event: запис і читання через репо, append-only (spec.md §7 KPI)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T10 lifecycle card' });

        const createdEvent = await insertLifecycleEvent(db, { id: crypto.randomUUID(), cardId: card.id, transition: 'created' });
        const filledEvent = await insertLifecycleEvent(db, { id: crypto.randomUUID(), cardId: card.id, transition: 'filled' });

        expect(createdEvent.transition).toBe('created');

        const events = await listLifecycleEventsByCard(db, card.id);
        expect(events.map((e) => e.id)).toEqual([createdEvent.id, filledEvent.id]);
      });
    } finally {
      await client.end();
    }
  });

  it('non-disclosure (AC-04): запит з owner_user_id іншого користувача не повертає жодного рядка', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerA) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId: ownerA, name: 'T10 owner-scoped card' });

        await withUser(client, async (dbB, ownerB) => {
          expect(await findCardById(dbB, ownerB, card.id)).toBeNull();
          expect((await listCardsByOwner(dbB, ownerB)).map((c) => c.id)).not.toContain(card.id);
          expect((await listActiveCardsByOwner(dbB, ownerB)).map((c) => c.id)).not.toContain(card.id);
          // Non-disclosure діє й на update: чужа картка не міняється, updateCardRow повертає null.
          expect(await updateCardRow(dbB, ownerB, card.id, { name: 'hijacked' })).toBeNull();
        });

        const stillOriginal = await findCardById(db, ownerA, card.id);
        expect(stillOriginal?.name).toBe('T10 owner-scoped card');
      });
    } finally {
      await client.end();
    }
  });

  it('updateCard: часткове оновлення (name/description окремо від status) — готує T14/T15/T33', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'Original' });

        const withDescription = await updateCardRow(db, ownerUserId, card.id, { description: 'Навіщо ця картка' });
        expect(withDescription?.description).toBe('Навіщо ця картка');
        expect(withDescription?.name).toBe('Original'); // name не займали -- лишається як була

        const archived = await updateCardRow(db, ownerUserId, card.id, { status: 'archived' });
        expect(archived?.status).toBe('archived');
        expect(archived?.description).toBe('Навіщо ця картка'); // status не займав опис

        const restored = await updateCardRow(db, ownerUserId, card.id, { status: 'active' });
        expect(restored?.status).toBe('active');
      });
    } finally {
      await client.end();
    }
  });

  it('listArchivedCardsByOwner: idx_card_owner_archived — лише архівовані, активна не потрапляє (AC-18, T34)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const active = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'Active card' });
        const archived = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'Archived card' });
        await updateCardRow(db, ownerUserId, archived.id, { status: 'archived' });

        const archivedList = await listArchivedCardsByOwner(db, ownerUserId);
        expect(archivedList.map((c) => c.id)).toEqual([archived.id]);
        expect(archivedList.map((c) => c.id)).not.toContain(active.id);
      });
    } finally {
      await client.end();
    }
  });

  it('усі 7 індексів data-model.md §Indexes реально використовуються, не seq scan (EXPLAIN)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');

      const capturedPlans: string[] = [];
      const explainDb: Db = {
        async query<T extends Record<string, unknown>>(text: string, params?: unknown[]) {
          const { rows } = await client.query(`EXPLAIN ${text}`, params);
          capturedPlans.push(rows.map((r) => String(r['QUERY PLAN'])).join('\n'));
          return { rows: [] as T[] };
        },
      };

      const dummyOwner = crypto.randomUUID();
      const dummyCard = crypto.randomUUID();
      const dummyBlock = crypto.randomUUID();

      await listCardsByOwner(explainDb, dummyOwner); // 0: idx_card_owner
      await listActiveCardsByOwner(explainDb, dummyOwner); // 1: idx_card_owner_active
      await listMetricBlocksByCard(explainDb, dummyCard); // 2: idx_metric_block_card
      await listEntriesByMetricBlock(explainDb, dummyBlock); // 3: idx_entry_metric_block
      await listEntriesByCard(explainDb, dummyCard); // 4: idx_entry_card_recorded
      await listPendingEntriesByCard(explainDb, dummyCard); // 5: idx_entry_card_pending
      await listLifecycleEventsByCard(explainDb, dummyCard); // 6: idx_lifecycle_card_time

      await client.query('ROLLBACK');

      expect(capturedPlans[0]).toContain('idx_card_owner');
      expect(capturedPlans[1]).toContain('idx_card_owner_active');
      expect(capturedPlans[2]).toContain('idx_metric_block_card');
      expect(capturedPlans[3]).toContain('idx_entry_metric_block');
      expect(capturedPlans[4]).toContain('idx_entry_card_recorded');
      expect(capturedPlans[5]).toContain('idx_entry_card_pending');
      expect(capturedPlans[6]).toContain('idx_lifecycle_card_time');
    } finally {
      await client.end();
    }
  });

  it('updateMetricBlock: перенесення на іншу картку + перейменування — готує T17', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const cardA = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 source card' });
        const cardB = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 destination card' });
        const block = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: cardA.id, label: 'Книги', unit: 'шт' });

        const moved = await updateMetricBlock(db, block.id, { cardId: cardB.id, label: 'Книги (перенесено)' });
        expect(moved?.cardId).toBe(cardB.id);
        expect(moved?.label).toBe('Книги (перенесено)');
        expect(moved?.unit).toBe('шт'); // unit не займали -- лишається як була

        const onDestination = await listMetricBlocksByCard(db, cardB.id);
        expect(onDestination.map((b) => b.id)).toContain(block.id);
        const onSource = await listMetricBlocksByCard(db, cardA.id);
        expect(onSource.map((b) => b.id)).not.toContain(block.id);
      });
    } finally {
      await client.end();
    }
  });

  it('findMetricBlockByCardLabelUnit: реально знаходить колізію назва+одиниця (AC-15, готує T17)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 collision card' });
        const existing = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: card.id, label: 'Пробіжки', unit: 'км' });

        const collision = await findMetricBlockByCardLabelUnit(db, card.id, 'Пробіжки', 'км');
        expect(collision?.id).toBe(existing.id);

        const noCollision = await findMetricBlockByCardLabelUnit(db, card.id, 'Пробіжки', 'милі');
        expect(noCollision).toBeNull();
      });
    } finally {
      await client.end();
    }
  });

  it('reassignEntriesToCard: перенесення блоку рухає й усі його записи (AC-14, готує T17)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const cardA = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 entries source' });
        const cardB = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 entries destination' });
        const block = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: cardA.id, label: 'Відтискання', unit: 'раз' });
        const entry = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: cardA.id, amount: 10 });

        await updateMetricBlock(db, block.id, { cardId: cardB.id });
        await reassignEntriesToCard(db, block.id, cardB.id);

        const onDestination = await listEntriesByCard(db, cardB.id);
        expect(onDestination.map((e) => e.id)).toContain(entry.id);
        const onSource = await listEntriesByCard(db, cardA.id);
        expect(onSource.map((e) => e.id)).not.toContain(entry.id);
        // idx_entry_metric_block і далі бачить запис під тим самим блоком, незалежно від картки.
        expect((await listEntriesByMetricBlock(db, block.id)).map((e) => e.id)).toContain(entry.id);
      });
    } finally {
      await client.end();
    }
  });

  it('updateEntryStatus: переводить pending -> confirmed/rejected, виставляє confirmed_at (готує T19)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T19 card' });
        const block = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: card.id, label: 'Читання', unit: 'сторінки' });
        const entryA = await insertEntry(db, {
          id: crypto.randomUUID(),
          metricBlockId: block.id,
          cardId: card.id,
          amount: 5,
          status: 'pending',
        });
        const entryB = await insertEntry(db, {
          id: crypto.randomUUID(),
          metricBlockId: block.id,
          cardId: card.id,
          amount: 5,
          status: 'pending',
        });

        const confirmed = await updateEntryStatus(db, entryA.id, 'confirmed');
        expect(confirmed?.status).toBe('confirmed');
        expect(confirmed?.confirmedAt).not.toBeNull();

        const rejected = await updateEntryStatus(db, entryB.id, 'rejected');
        expect(rejected?.status).toBe('rejected');
        expect(rejected?.confirmedAt).not.toBeNull();

        // Запис лишається читомим напряму (AC-12), ніколи фізично не видаляється.
        expect((await listEntriesByMetricBlock(db, block.id)).map((e) => e.id)).toEqual(
          expect.arrayContaining([entryA.id, entryB.id])
        );
      });
    } finally {
      await client.end();
    }
  });
});

describe('Хвиля 5, батч A — use-case шар (T13/T14/T15/T33/T34) — проти реальної Neon', () => {
  async function withUser<T>(client: Client, run: (db: Db, ownerUserId: string) => Promise<T>): Promise<T> {
    const ownerUserId = crypto.randomUUID();
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerUserId,
      `test-wave5-${ownerUserId}`,
      'wave5@example.test',
    ]);
    try {
      return await run(client, ownerUserId);
    } finally {
      await client.query('DELETE FROM app_user WHERE id = $1', [ownerUserId]);
    }
  }

  it('T13 createCard: щасливий шлях створює картку + подію "created" (AC-02)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const record = await createCard(db, { ownerUserId, name: 'T13 integration card' });
        expect(record.status).toBe('active');

        const events = await listLifecycleEventsByCard(db, record.id);
        expect(events.map((e) => e.transition)).toEqual(['created']);
      });
    } finally {
      await client.end();
    }
  });

  it('T13 createCard: порожня назва відхиляється БЕЗ жодного запису (AC-02)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        await expect(createCard(db, { ownerUserId, name: '' })).rejects.toThrow();
        expect(await listCardsByOwner(db, ownerUserId)).toEqual([]);
      });
    } finally {
      await client.end();
    }
  });

  it('T14 updateCard: Опис зберігається окремо від позначення "заповнена" (AC-03)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T14 integration card' });

        const result = await updateCard(db, { ownerUserId, cardId: card.id, description: 'Навіщо ця картка' });
        expect(result.description).toBe('Навіщо ця картка');

        // Опис збережено, але картка НЕ позначена "заповненою" -- жодної lifecycle-події.
        expect(await listLifecycleEventsByCard(db, card.id)).toEqual([]);
      });
    } finally {
      await client.end();
    }
  });

  it('T14 updateCard: позначення "заповнена" без Опису відхиляється (AC-03)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T14 no-description card' });

        await expect(updateCard(db, { ownerUserId, cardId: card.id, markFilled: true })).rejects.toThrow();

        const stillNoDescription = await findCardById(db, ownerUserId, card.id);
        expect(stillNoDescription?.description).toBeNull();
        expect(await listLifecycleEventsByCard(db, card.id)).toEqual([]);
      });
    } finally {
      await client.end();
    }
  });

  it('T15 archiveCard: архівація виключає картку зі списку активних, рядок лишається читомим напряму (AC-16)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T15 integration card' });

        const archived = await archiveCard(db, { ownerUserId, cardId: card.id });
        expect(archived.status).toBe('archived');

        const activeList = await listActiveCardsByOwner(db, ownerUserId);
        expect(activeList.map((c) => c.id)).not.toContain(card.id);

        const readDirectly = await findCardById(db, ownerUserId, card.id);
        expect(readDirectly?.status).toBe('archived');
      });
    } finally {
      await client.end();
    }
  });

  it('T33 restoreCard: розархівація активної (не архівованої) картки -- card.not_archived, нічого не пишеться (AC-17)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T33 active card' });

        await expect(restoreCard(db, ownerUserId, card.id)).rejects.toMatchObject({ code: 'card.not_archived' });

        const stillActive = await findCardById(db, ownerUserId, card.id);
        expect(stillActive?.status).toBe('active');
        expect(await listLifecycleEventsByCard(db, card.id)).toEqual([]);
      });
    } finally {
      await client.end();
    }
  });

  it('T33 restoreCard: розархівація архівованої картки -- status active, знову в listCards за замовчуванням (AC-17)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T33 archived card' });
        await updateCardRow(db, ownerUserId, card.id, { status: 'archived' });

        const restored = await restoreCard(db, ownerUserId, card.id);
        expect(restored.status).toBe('active');

        const defaultList = await listCards(db, ownerUserId);
        expect(defaultList.map((c) => c.id)).toContain(card.id);
      });
    } finally {
      await client.end();
    }
  });

  it('T34 listCards: status=archived повертає лише архівовані, найновіші зверху (AC-18)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const active = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T34 active' });
        const archivedOlder = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T34 archived older' });
        await updateCardRow(db, ownerUserId, archivedOlder.id, { status: 'archived' });
        const archivedNewer = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T34 archived newer' });
        await updateCardRow(db, ownerUserId, archivedNewer.id, { status: 'archived' });

        const archivedList = await listCards(db, ownerUserId, 'archived');
        expect(archivedList.map((c) => c.id)).toEqual([archivedNewer.id, archivedOlder.id]);
        expect(archivedList.map((c) => c.id)).not.toContain(active.id);
      });
    } finally {
      await client.end();
    }
  });

  it('T34 listCards: виклик без параметра поводиться як і раніше -- лише активні (AC-04 не зламано)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const active = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T34 default active' });
        const archived = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T34 default archived' });
        await updateCardRow(db, ownerUserId, archived.id, { status: 'archived' });

        const defaultList = await listCards(db, ownerUserId);
        expect(defaultList.map((c) => c.id)).toContain(active.id);
        expect(defaultList.map((c) => c.id)).not.toContain(archived.id);
      });
    } finally {
      await client.end();
    }
  });
});

describe('structure T1/T2/T26 (D-103, промоучено позачергово) — проти реальної Neon', () => {
  it('T1: UNIQUE на structure.owner_user_id реально відхиляє другий рядок того самого власника', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-structure-t1-${ownerId}`,
        'structure-t1@example.test',
      ]);
      try {
        await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [crypto.randomUUID(), ownerId]);
        await expect(
          client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [crypto.randomUUID(), ownerId])
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає structure
      }
    } finally {
      await client.end();
    }
  });

  it('T2: частковий унікальний індекс — не більше однієї АКТИВНОЇ картки в клітинці (AC-02/D-62)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      const cardOneId = crypto.randomUUID();
      const cardTwoId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-structure-t2-${ownerId}`,
        'structure-t2@example.test',
      ]);
      await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardOneId, ownerId, 'Card 1']);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardTwoId, ownerId, 'Card 2']);
      try {
        await client.query(
          'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)',
          [crypto.randomUUID(), structureId, cardOneId]
        );
        await expect(
          client.query(
            'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)',
            [crypto.randomUUID(), structureId, cardTwoId]
          )
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає все нижче
      }
    } finally {
      await client.end();
    }
  });

  it('T2: видалення card каскадно видаляє її structure_layout_position (FK ON DELETE CASCADE)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const positionId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-structure-t2-cascade-${ownerId}`,
        'structure-t2-cascade@example.test',
      ]);
      await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
      await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardId, ownerId, 'Card']);
      await client.query(
        'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)',
        [positionId, structureId, cardId]
      );

      await client.query('DELETE FROM card WHERE id = $1', [cardId]);

      const { rows } = await client.query('SELECT id FROM structure_layout_position WHERE id = $1', [positionId]);
      expect(rows).toHaveLength(0);

      await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
    } finally {
      await client.end();
    }
  });

  it('T26: видалення app_user каскадно видаляє structure (і, транзитивно, її layout positions)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-structure-t26-${ownerId}`,
        'structure-t26@example.test',
      ]);
      await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);

      await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);

      const { rows } = await client.query('SELECT id FROM structure WHERE id = $1', [structureId]);
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});

describe('D-69/D-103 (закриває ISS-26) — archiveCard реально закриває позицію в розкладці, проти реальної Neon', () => {
  it('архівація картки, розкладеної в Структурі, закриває її активну позицію в тій самій дії', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-d103-${ownerId}`,
        'd103@example.test',
      ]);
      try {
        const db: Db = client;
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId: ownerId, name: 'D-103 laid-out card' });

        const structureId = crypto.randomUUID();
        const positionId = crypto.randomUUID();
        await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
        await client.query(
          'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)',
          [positionId, structureId, card.id]
        );

        await archiveCard(db, { ownerUserId: ownerId, cardId: card.id }, closeActiveLayoutPositionForCard);

        const { rows } = await client.query('SELECT status FROM structure_layout_position WHERE id = $1', [positionId]);
        expect(rows[0].status).toBe('closed');
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
      }
    } finally {
      await client.end();
    }
  });

  it('картка без жодної позиції в розкладці архівується нормально (нема що закривати)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-d103-no-position-${ownerId}`,
        'd103-no-position@example.test',
      ]);
      try {
        const db: Db = client;
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId: ownerId, name: 'D-103 unlaid card' });

        await expect(
          archiveCard(db, { ownerUserId: ownerId, cardId: card.id }, closeActiveLayoutPositionForCard)
        ).resolves.toMatchObject({ status: 'archived' });
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
      }
    } finally {
      await client.end();
    }
  });
});

describe('Хвиля 5, батч B — use-case шар (T16/T17/T18/T19/T20) — проти реальної Neon', () => {
  async function withUser<T>(client: Client, run: (db: Db, ownerUserId: string) => Promise<T>): Promise<T> {
    const ownerUserId = crypto.randomUUID();
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerUserId,
      `test-wave5b-${ownerUserId}`,
      'wave5b@example.test',
    ]);
    try {
      return await run(client, ownerUserId);
    } finally {
      await client.query('DELETE FROM app_user WHERE id = $1', [ownerUserId]);
    }
  }

  // --- T16 createMetricBlock -------------------------------------------------

  it('T16 createMetricBlock: блок з фіксованою ціллю створюється (AC-05/AC-07)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T16 fixed target card' });
        const block = await createMetricBlock(db, { ownerUserId, cardId: card.id, label: 'Книги', unit: 'книги', targetCount: 12 });

        expect(block.targetCount).toBe(12);
        expect(block.isOngoing).toBe(false);

        const blocks = await listMetricBlocksByCard(db, card.id);
        expect(blocks.map((b) => b.id)).toContain(block.id);
      });
    } finally {
      await client.end();
    }
  });

  it('T16 createMetricBlock: is_ongoing:true створюється без target_date (AC-05)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T16 ongoing card' });
        const block = await createMetricBlock(db, {
          ownerUserId,
          cardId: card.id,
          label: 'Медитація',
          unit: 'хвилини',
          isOngoing: true,
        });

        expect(block.isOngoing).toBe(true);
        expect(block.targetDate).toBeNull();
      });
    } finally {
      await client.end();
    }
  });

  it('T16 createMetricBlock: картка без жодного виклику лишається декларативною (AC-08)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T16 declarative card' });

        const blocks = await listMetricBlocksByCard(db, card.id);
        expect(blocks).toEqual([]);

        const stillActive = await findCardById(db, ownerUserId, card.id);
        expect(stillActive?.status).toBe('active');
      });
    } finally {
      await client.end();
    }
  });

  // --- T17 transferMetricBlock -------------------------------------------------

  it('T17 transferMetricBlock: перенесення без колізії — блок і всі записи опиняються в новій картці (AC-14)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const sourceCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 source card' });
        const targetCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 target card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: sourceCard.id,
          label: 'Пробіжки',
          unit: 'км',
          targetCount: 20,
        });
        const entry = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: sourceCard.id, amount: 5 });

        const result = await transferMetricBlock(db, {
          ownerUserId,
          targetCardId: targetCard.id,
          metricBlockId: block.id,
        });

        expect(result.cardId).toBe(targetCard.id);

        const targetBlocks = await listMetricBlocksByCard(db, targetCard.id);
        expect(targetBlocks.map((b) => b.id)).toContain(block.id);

        const targetEntries = await listEntriesByCard(db, targetCard.id);
        expect(targetEntries.map((e) => e.id)).toContain(entry.id);

        const sourceEntries = await listEntriesByCard(db, sourceCard.id);
        expect(sourceEntries.map((e) => e.id)).not.toContain(entry.id);
      });
    } finally {
      await client.end();
    }
  });

  it('T17 transferMetricBlock: колізія назва+одиниця без newLabel відхиляється, нічого не переноситься (AC-15)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const sourceCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 source (collision)' });
        const targetCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 target (collision)' });
        const block = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: sourceCard.id, label: 'Плавання', unit: 'км' });
        await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: targetCard.id, label: 'Плавання', unit: 'км' });

        await expect(
          transferMetricBlock(db, {
            ownerUserId,
            targetCardId: targetCard.id,
            metricBlockId: block.id,
          })
        ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });

        const stillInSource = await listMetricBlocksByCard(db, sourceCard.id);
        expect(stillInSource.map((b) => b.id)).toContain(block.id);
      });
    } finally {
      await client.end();
    }
  });

  it('T17 transferMetricBlock: чужий metricBlockId (інший власник) відхиляється тим самим card.not_found (ISS-30)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const targetCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 target (foreign block)' });

        await withUser(client, async (otherDb, otherOwnerUserId) => {
          const foreignSourceCard = await insertCard(otherDb, {
            id: crypto.randomUUID(),
            ownerUserId: otherOwnerUserId,
            name: 'T17 foreign source card',
          });
          const foreignBlock = await insertMetricBlock(otherDb, {
            id: crypto.randomUUID(),
            cardId: foreignSourceCard.id,
            label: 'Чужий блок',
            unit: 'разів',
          });

          await expect(
            transferMetricBlock(db, { ownerUserId, targetCardId: targetCard.id, metricBlockId: foreignBlock.id })
          ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });

          const stillOnForeignCard = await listMetricBlocksByCard(otherDb, foreignSourceCard.id);
          expect(stillOnForeignCard.map((b) => b.id)).toContain(foreignBlock.id); // нічого не перенесено
        });
      });
    } finally {
      await client.end();
    }
  });

  it('T17 transferMetricBlock: колізія з newLabel завершує перенесення під новою назвою (AC-15)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const sourceCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 source (newLabel)' });
        const targetCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T17 target (newLabel)' });
        const block = await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: sourceCard.id, label: 'Йога', unit: 'хвилини' });
        await insertMetricBlock(db, { id: crypto.randomUUID(), cardId: targetCard.id, label: 'Йога', unit: 'хвилини' });

        const result = await transferMetricBlock(db, {
          ownerUserId,
          targetCardId: targetCard.id,
          metricBlockId: block.id,
          newLabel: 'Йога (2)',
        });

        expect(result.label).toBe('Йога (2)');
        expect(result.cardId).toBe(targetCard.id);
      });
    } finally {
      await client.end();
    }
  });

  // --- T18 createEntry -------------------------------------------------

  it('T18 createEntry: щасливий шлях -> confirmed, прогрес оновлюється (AC-01)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T18 happy path card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Пробіжки',
          unit: 'км',
          targetCount: 10,
        });

        const entry = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 4,
          recordedAt: Date.now(),
          sourceDeviceId: 'device-a',
        });

        expect(entry.status).toBe('confirmed');

        const { metricBlocks } = await getCardWithProgress(db, { ownerUserId, cardId: card.id });
        expect(metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 0.4 });
      });
    } finally {
      await client.end();
    }
  });

  it('T18 createEntry: конфліктний запис -> обидва pending, прогрес не змінюється (AC-06)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T18 conflict card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Читання',
          unit: 'сторінки',
          targetCount: 100,
        });
        const recordedAt = Date.now();

        const first = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 10,
          recordedAt,
          sourceDeviceId: 'device-a',
        });
        expect(first.status).toBe('confirmed');

        const second = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 5,
          recordedAt: recordedAt + 1_000,
          sourceDeviceId: 'device-b',
        });
        expect(second.status).toBe('pending');

        const rowsAfterConflict = await listEntriesByMetricBlock(db, block.id);
        const firstRowAfterConflict = rowsAfterConflict.find((e) => e.id === first.id);
        expect(firstRowAfterConflict?.status).toBe('pending'); // переведений другим, обидва pending

        const { metricBlocks } = await getCardWithProgress(db, { ownerUserId, cardId: card.id });
        expect(metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 0 }); // жоден не confirmed
      });
    } finally {
      await client.end();
    }
  });

  it('T18 createEntry: чужий/довільний metricBlockId у своїй картці відхиляється (AC-04)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const ownCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T18 own card' });
        const otherCard = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T18 other card' });
        const foreignBlock = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: otherCard.id,
          label: 'Чужий блок',
          unit: 'разів',
        });

        await expect(
          createEntry(db, { ownerUserId, cardId: ownCard.id, metricBlockId: foreignBlock.id, amount: 1, recordedAt: Date.now() })
        ).rejects.toMatchObject({ code: 'metric_block.not_found', httpStatus: 404 });

        const entriesOnForeignBlock = await listEntriesByMetricBlock(db, foreignBlock.id);
        expect(entriesOnForeignBlock).toEqual([]);
      });
    } finally {
      await client.end();
    }
  });

  // --- T19 resolveEntry -------------------------------------------------

  it('T19 resolveEntry: вирішення конфліктної пари — один confirmed, інший rejected, прогрес перераховується (AC-06)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T19 conflict pair card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Плавання',
          unit: 'км',
          targetCount: 10,
        });
        const recordedAt = Date.now();

        const first = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 3,
          recordedAt,
          sourceDeviceId: 'device-a',
        });
        const second = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 2,
          recordedAt: recordedAt + 500,
          sourceDeviceId: 'device-b',
        });

        const beforeResolution = await listEntriesByMetricBlock(db, block.id);
        expect(beforeResolution.every((e) => e.status === 'pending')).toBe(true); // обидва pending -- конфлікт

        const confirmed = await resolveEntry(db, { ownerUserId, cardId: card.id, entryId: first.id, resolution: 'confirm' });
        const rejected = await resolveEntry(db, { ownerUserId, cardId: card.id, entryId: second.id, resolution: 'reject' });

        expect(confirmed.status).toBe('confirmed');
        expect(rejected.status).toBe('rejected');

        const { metricBlocks } = await getCardWithProgress(db, { ownerUserId, cardId: card.id });
        expect(metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 0.3 }); // лише перший (3/10) рахується
      });
    } finally {
      await client.end();
    }
  });

  it('T19 resolveEntry: підтвердження pending-запису після повернення агента -> confirmed (AC-11)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T19 agent unavailable card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Йога',
          unit: 'хвилини',
          targetCount: 60,
        });

        const entry = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 20,
          recordedAt: Date.now(),
          agentAvailable: false,
        });
        expect(entry.status).toBe('pending');

        const confirmed = await resolveEntry(db, { ownerUserId, cardId: card.id, entryId: entry.id, resolution: 'confirm' });
        expect(confirmed.status).toBe('confirmed');
      });
    } finally {
      await client.end();
    }
  });

  it('T19 resolveEntry: виправлення з історії -> rejected, запис лишається читомим (AC-12)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T19 history fix card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Біг',
          unit: 'км',
          targetCount: 50,
        });

        const entry = await createEntry(db, {
          ownerUserId,
          cardId: card.id,
          metricBlockId: block.id,
          amount: 8,
          recordedAt: Date.now(),
          sourceDeviceId: 'device-a',
        });
        expect(entry.status).toBe('confirmed');

        const rejected = await resolveEntry(db, { ownerUserId, cardId: card.id, entryId: entry.id, resolution: 'reject' });
        expect(rejected.status).toBe('rejected');

        const historyRow = (await listEntriesByCard(db, card.id)).find((e) => e.id === entry.id);
        expect(historyRow).not.toBeUndefined(); // рядок лишається читомим, не видалений
        expect(historyRow?.status).toBe('rejected');
      });
    } finally {
      await client.end();
    }
  });

  // --- T20 getCardWithProgress -------------------------------------------------

  it('T20 getCardWithProgress: відповідь містить прогрес по кожному блоку + агрегат (AC-09)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T20 aggregate card' });
        const blockA = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Книги',
          unit: 'книги',
          targetCount: 10,
        });
        const blockB = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Біг',
          unit: 'км',
          targetCount: 20,
        });
        await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: blockA.id, cardId: card.id, amount: 5 });
        await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: blockB.id, cardId: card.id, amount: 5 });

        const result = await getCardWithProgress(db, { ownerUserId, cardId: card.id });

        expect(result.metricBlocks).toHaveLength(2);
        expect(result.aggregateProgress).toBeCloseTo(0.375); // (0.5 + 0.25) / 2
      });
    } finally {
      await client.end();
    }
  });

  it('T20 getCardWithProgress: перевищення цілі -- capped share + окремий надлишок (AC-09b)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T20 over-goal card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Плавання',
          unit: 'км',
          targetCount: 10,
        });
        await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: card.id, amount: 14 });

        const result = await getCardWithProgress(db, { ownerUserId, cardId: card.id });

        expect(result.metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 1, overGoal: 4 });
      });
    } finally {
      await client.end();
    }
  });

  it('T20 getCardWithProgress: dataWarning заповнено лише коли інжектований callClaude щось знайшов (AC-10)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    try {
      await withUser(client, async (db, ownerUserId) => {
        const card = await insertCard(db, { id: crypto.randomUUID(), ownerUserId, name: 'T20 data warning card' });
        const block = await insertMetricBlock(db, {
          id: crypto.randomUUID(),
          cardId: card.id,
          label: 'Читання',
          unit: 'сторінки',
          targetCount: 100,
        });
        await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId: card.id, amount: 3 });

        const suspicious = await getCardWithProgress(db, { ownerUserId, cardId: card.id }, async () => 'Занадто мало для щоденного читання');
        expect(suspicious.dataWarning).toBe('Занадто мало для щоденного читання');

        const clean = await getCardWithProgress(db, { ownerUserId, cardId: card.id }, async () => '');
        expect(clean.dataWarning).toBeNull();

        const notInjected = await getCardWithProgress(db, { ownerUserId, cardId: card.id });
        expect(notInjected.dataWarning).toBeNull();
      });
    } finally {
      await client.end();
    }
  });
});
