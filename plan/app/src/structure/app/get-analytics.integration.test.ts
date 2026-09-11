// T14 -- App: getAnalytics use-case, integration level (test-plan.md:
// AC-01/AC-05/AC-07 -- "integration"; AC-04/AC-06/AC-06b/AC-13 covered at unit
// level in ./get-analytics.test.ts).
//
// Проти РЕАЛЬНОЇ Neon (server/db.ts createDb(), ADR-0006) -- та сама
// конвенція, що вже використовує ./update-structure.integration.test.ts і
// ./move-card.integration.test.ts. Docker/Neon відсутні в цьому середовищі
// (DATABASE_URL_POOLED/.env недоступні тут) -- очікується NON-red
// (createDb() кине одразу в beforeAll, чи запит впаде на мережі), не GOOD
// red; ./get-analytics.test.ts (unit, мокований Db + injected getCardProgress)
// лишається джерелом TDD-циклу локально.
//
// T14 DoD (tracker.md): "Integration test: analytics reflects a
// just-corrected card entry without a separately cached number; trend uses
// the history-log asOf read" -- нижче реальний life-area-card entry (T7's
// resolveEntry, той самий механізм AC-12 виправлення/відкату) корегується
// МІЖ двома викликами getAnalytics проти тієї самої бази, і другий виклик
// має відбити нове число без жодного окремого кешу (AC-05).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAnalytics } from './get-analytics';
import { computeProgress, computeAggregateProgress } from '../../cards/life-area-card/domain/progress';
import { insertMetricBlock, insertEntry, listMetricBlocksByCard, listEntriesByMetricBlock } from '../../cards/life-area-card/infra/postgres-repo';
import { resolveEntry } from '../../cards/life-area-card/app/resolve-entry';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('getAnalytics (integration) -- AC-01/AC-05/AC-07 проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let cardId: string;

  /**
   * Той самий обчислювальний код, що показує сама картка (../get-card.ts) --
   * НІКОЛИ окремо збережене число (AC-05): читає сирі metric-block/entry
   * рядки заново на кожен виклик і рахує через life-area-card's власну
   * доменну формулу (ADR-0001 тієї фічі), точнісінько як get-card.ts робить.
   */
  async function getCardProgress(currentCardId: string) {
    const blocks = await listMetricBlocksByCard(db, currentCardId);
    const progresses = [];
    for (const block of blocks) {
      const entries = await listEntriesByMetricBlock(db, block.id);
      progresses.push(
        computeProgress(
          { targetCount: block.targetCount, isOngoing: block.isOngoing },
          entries.map((e) => ({ amount: e.amount, status: e.status }))
        )
      );
    }
    return {
      progress: computeAggregateProgress(progresses),
      hasMetricBlock: blocks.length > 0,
      entryCount: progresses.length,
    };
  }

  beforeAll(async () => {
    db = createDb();

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t14-${ownerId}`,
      't14@example.test',
    ]);

    const structureId = crypto.randomUUID();
    await db.query("INSERT INTO structure (id, owner_user_id, layout_mode) VALUES ($1, $2, 'free')", [
      structureId,
      ownerId,
    ]);

    cardId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardId, ownerId, 'T14 card']);
    await db.query('INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)', [
      crypto.randomUUID(),
      structureId,
      cardId,
    ]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/structure/positions/entries
    await db.end();
  });

  it('reflects a just-corrected card entry without a separately cached number (AC-01, AC-05)', async () => {
    const block = await insertMetricBlock(db, {
      id: crypto.randomUUID(),
      cardId,
      label: 'T14 block',
      unit: 'raz',
      targetCount: 10,
      isOngoing: false,
    });
    const entry = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId, amount: 2 });
    await resolveEntry(db, { ownerUserId: ownerId, entryId: entry.id, status: 'confirmed' });

    const before = await getAnalytics(db, { ownerUserId: ownerId }, getCardProgress);
    expect(before.average).toBeCloseTo(0.2); // 2/10

    // AC-12 (life-area-card) виправлення: відкочуємо підтверджений запис і
    // підтверджуємо новий, більший -- той самий мовою "картка сама виправляє
    // свій запис", getAnalytics про це нічого не знає напряму.
    await resolveEntry(db, { ownerUserId: ownerId, entryId: entry.id, status: 'rejected' });
    const correctedEntry = await insertEntry(db, { id: crypto.randomUUID(), metricBlockId: block.id, cardId, amount: 8 });
    await resolveEntry(db, { ownerUserId: ownerId, entryId: correctedEntry.id, status: 'confirmed' });

    const after = await getAnalytics(db, { ownerUserId: ownerId }, getCardProgress);
    // AC-05: жодного розбіжного/застарілого значення -- друге читання одразу
    // відбиває виправлення, без окремо збереженого числа десь усередині getAnalytics.
    expect(after.average).toBeCloseTo(0.8); // 8/10
  });

  it('does not throw when no history event exists before asOf -- trend is reported unavailable (null)', async () => {
    const result = await getAnalytics(
      db,
      { ownerUserId: ownerId, asOf: new Date('2000-01-01T00:00:00Z') },
      getCardProgress
    );

    expect(result.cards.every((c: any) => c.trend === null)).toBe(true);
    expect(result.average).not.toBeNull();
  });
});
