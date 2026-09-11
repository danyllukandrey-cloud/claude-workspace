// T25 -- Tests: cross-cutting integration (AC-05 + offline sync).
//
// RED (unit level, stateful in-memory fake `Db` -- test-plan.md has no dedicated
// row for T25; Docker/Neon are unavailable in this sandbox, so this file follows
// the same fallback already used by ./move-card.test.ts: a fake `Db.query` routed
// by SQL text, but here MUTABLE state shared across BOTH scenarios below, since
// neither scenario is provable with fixed canned responses -- each needs a second
// read to see the effect of a write that happened in between.
//
// Review 2026-09-11/12 (ISS-100 review-fix wave): the backend `get-analytics.ts`
// use-case this AC-05 test originally called against was confirmed dead code
// (0 production callers, ADR-0001 -- Structure's aggregate is recomputed
// CLIENT-side, never a cached backend number) and deleted. This test now proves
// the same cross-module AC-05 guarantee through the actual production path:
// `computeStructureAggregate` (domain/aggregate.ts) fed by `getCardProgress`,
// the same shape `main.tsx`'s `loadAnalytics()` builds.
//
// This file exists because T12 (moveCard) and T14 (Structure's aggregate) each
// already have their own unit + integration tests, but nothing yet runs them
// TOGETHER against one shared store the way a real deployment would -- this is
// the "do these two already-implemented pieces actually agree with each other"
// check (AC-05 spans TWO modules -- life-area-card's resolveEntry and
// structure's aggregate -- and the offline-sync scenario spans TWO calls to
// moveCard simulating two devices).

import { describe, it, expect } from 'vitest';
import { computeStructureAggregate } from '../domain/aggregate';
import { moveCard } from './move-card';
import { resolveEntry } from '../../cards/life-area-card/app/resolve-entry';
import { computeProgress, computeAggregateProgress } from '../../cards/life-area-card/domain/progress';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';
const CARD_ID = 'card-1';
const METRIC_BLOCK_ID = 'block-1';

/**
 * Один спільний, МУТАБЕЛЬНИЙ фейковий Db -- обслуговує SQL і life-area-card
 * (card/metric_block/entry), і structure (structure/structure_layout_position/
 * structure_history_event) з тієї самої таблиці в пам'яті, так щоб запис з
 * одного use-case був видимий наступному читанню з іншого use-case -- саме
 * так поводиться одна реальна Postgres-база (D-113, обидва модулі -- одна БД).
 */
function makeSharedFakeDb() {
  const cards = [
    {
      id: CARD_ID,
      owner_user_id: OWNER,
      name: 'Здоров\'я',
      description: null as string | null,
      status: 'active' as const,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  const metricBlocks = [
    {
      id: METRIC_BLOCK_ID,
      card_id: CARD_ID,
      label: 'Тренування',
      unit: 'раз',
      frequency: null as string | null,
      target_count: '10',
      is_ongoing: false,
      target_date: null as Date | null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  const entries: Array<{
    id: string;
    metric_block_id: string;
    card_id: string;
    amount: string;
    raw_text: string | null;
    status: 'pending' | 'confirmed' | 'rejected';
    source_device_id: string | null;
    recorded_at: Date;
    confirmed_at: Date | null;
    created_at: Date;
  }> = [
    {
      id: 'entry-1',
      metric_block_id: METRIC_BLOCK_ID,
      card_id: CARD_ID,
      amount: '9', // помилково завелике число -- буде "виправлено" нижче через відхилення
      raw_text: null,
      status: 'confirmed',
      source_device_id: null,
      recorded_at: new Date('2026-01-02T00:00:00Z'),
      confirmed_at: new Date('2026-01-02T00:00:00Z'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    },
  ];

  const structures = [
    {
      id: STRUCTURE_ID,
      owner_user_id: OWNER,
      declaration: null as string | null,
      layout_mode: 'free' as const,
      logic_variant: null as string | null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  const positions: Array<{
    id: string;
    structure_id: string;
    card_id: string;
    cell_index: number;
    status: 'active' | 'closed';
    position_updated_at: Date;
    created_at: Date;
  }> = [
    {
      id: 'position-1',
      structure_id: STRUCTURE_ID,
      card_id: CARD_ID,
      cell_index: 0,
      status: 'active',
      position_updated_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  const historyEvents: unknown[] = [];

  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.trim().toUpperCase();

    // --- life-area-card ------------------------------------------------
    if (text.includes('FROM card WHERE id')) {
      const [id, ownerUserId] = params as [string, string];
      return { rows: cards.filter((c) => c.id === id && c.owner_user_id === ownerUserId) };
    }
    if (text.includes('FROM metric_block WHERE card_id')) {
      const [cardId] = params as [string];
      return { rows: metricBlocks.filter((b) => b.card_id === cardId) };
    }
    if (text.includes('FROM entry WHERE metric_block_id')) {
      const [blockId] = params as [string];
      return { rows: entries.filter((e) => e.metric_block_id === blockId) };
    }
    if (text.includes('FROM entry WHERE id')) {
      const [id] = params as [string];
      return { rows: entries.filter((e) => e.id === id) };
    }
    if (sql.startsWith('UPDATE ENTRY')) {
      const [status, id] = params as [string, string];
      const entry = entries.find((e) => e.id === id);
      if (!entry) return { rows: [] };
      entry.status = status as 'pending' | 'confirmed' | 'rejected';
      return { rows: [entry] };
    }

    // --- structure -------------------------------------------------------
    // Ця перевірка МУСИТЬ бути вужчою, ніж просто "рядок містить текст
    // 'FROM structure WHERE owner_user_id'" -- updateLayoutPositionCell нижче
    // має підзапит `(SELECT id FROM structure WHERE owner_user_id = $4)` усередині
    // UPDATE, і без sql.startsWith('SELECT') ця гілка помилково перехопила б той
    // UPDATE-запит як findStructureByOwner.
    if (sql.startsWith('SELECT') && text.includes('FROM structure WHERE owner_user_id')) {
      const [ownerUserId] = params as [string];
      return { rows: structures.filter((s) => s.owner_user_id === ownerUserId) };
    }
    if (text.includes('structure_layout_position') && text.includes('JOIN structure')) {
      const [ownerUserId] = params as [string];
      const ownedStructureIds = structures.filter((s) => s.owner_user_id === ownerUserId).map((s) => s.id);
      return {
        rows: positions.filter((p) => ownedStructureIds.includes(p.structure_id) && p.status === 'active'),
      };
    }
    if (sql.startsWith('UPDATE STRUCTURE_LAYOUT_POSITION')) {
      const [cellIndex, positionUpdatedAt, cardId, ownerUserId] = params as [number, string, string, string];
      const ownedStructureIds = structures.filter((s) => s.owner_user_id === ownerUserId).map((s) => s.id);
      const position = positions.find(
        (p) => p.card_id === cardId && p.status === 'active' && ownedStructureIds.includes(p.structure_id)
      );
      if (!position) return { rows: [] };
      position.cell_index = cellIndex;
      position.position_updated_at = new Date(positionUpdatedAt);
      return { rows: [position] };
    }
    if (text.includes('structure_history_event') && sql.startsWith('INSERT')) {
      const [id, structureId, cardId, eventType, detail] = params as [string, string, string, string, string | null];
      const row = {
        id,
        structure_id: structureId,
        card_id: cardId,
        event_type: eventType,
        detail,
        occurred_at: new Date(),
      };
      historyEvents.push(row);
      return { rows: [row] };
    }

    throw new Error(`Непередбачений запит у cross-cutting тесті: ${text}`);
  };

  return { query: query as unknown as Db['query'], positions, entries };
}

/**
 * Той самий обчислювальний шлях, що life-area-card's власний get-card.ts
 * показує на екрані картки (AC-05) -- ЖОДНОГО окремо збереженого числа: рахує
 * з сирих metric_block/entry рядків заново на кожен виклик.
 */
function makeGetCardProgress(db: Db) {
  return async (cardId: string) => {
    const { rows: blocks } = await db.query<any>('SELECT id, card_id, target_count, is_ongoing FROM metric_block WHERE card_id = $1', [
      cardId,
    ]);
    const progresses = [];
    let hasMetricBlock = false;
    let entryCount = 0;
    for (const block of blocks) {
      hasMetricBlock = true;
      const { rows: entryRows } = await db.query<any>('SELECT * FROM entry WHERE metric_block_id = $1', [block.id]);
      entryCount += entryRows.length;
      progresses.push(
        computeProgress(
          { targetCount: block.target_count == null ? null : Number(block.target_count), isOngoing: block.is_ongoing },
          entryRows.map((e: any) => ({ amount: Number(e.amount), status: e.status }))
        )
      );
    }
    return { progress: computeAggregateProgress(progresses), hasMetricBlock, entryCount };
  };
}

describe('T25 cross-cutting -- AC-05: correcting a life-area-card entry immediately updates Structure analytics', () => {
  it('reflects the corrected number on the very next aggregate computation, no separately cached value', async () => {
    const { query, positions } = makeSharedFakeDb();
    const db: Db = { query };
    const getCardProgress = makeGetCardProgress(db);

    // Той самий крок, що main.tsx's loadAnalytics() робить у продакшені: читає
    // активну позицію картки (для cellIndex) + її прогрес наживо, будує вхід
    // computeStructureAggregate -- жодного окремо збереженого числа.
    async function aggregateNow() {
      const progress = (await getCardProgress(CARD_ID)).progress;
      const position = positions.find((p) => p.card_id === CARD_ID);
      return computeStructureAggregate([{ cardId: CARD_ID, cellIndex: position?.cell_index ?? -1, progress }]);
    }

    const before = await aggregateNow();
    // 9/10 (target_count) capped -- picked so the "before" number is clearly wrong/high.
    expect(before.average).toBeCloseTo(0.9);

    // Виправлення записаного факту через ТОЙ САМИЙ механізм, що life-area-card
    // AC-12 -- відхилення вже підтвердженого запису (помилковий 9 було відкликано).
    await resolveEntry(db, { ownerUserId: OWNER, entryId: 'entry-1', status: 'rejected' });

    const after = await aggregateNow();

    // rejected-запис не рахується в прогресі -- 0 підтверджених записів лишилось.
    expect(after.average).toBeCloseTo(0);
    expect(after.average).not.toBe(before.average);
  });
});

describe('T25 cross-cutting -- offline move syncs and resolves conflict per ADR-0002 on reconnect', () => {
  it('a stale offline write from device A loses to the later write from device B once both reach the backend', async () => {
    const { query, positions } = makeSharedFakeDb();
    const db: Db = { query };

    // Пристрій A був офлайн, редагував о 10:00, підключився й дійшов до бекенду ПІЗНІШЕ.
    // Пристрій B був офлайн, редагував о 11:00 (пізніше за фактом), підключився РАНІШЕ.
    // На реконнекті обидва запити зрештою доходять до бекенду -- порядок доходження
    // мережею не збігається з порядком реального редагування, тож last-write-wins
    // (ADR-0002) має орієнтуватись на positionUpdatedAt, а не на порядок надходження.
    const deviceBWrite = moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 3,
      positionUpdatedAt: '2026-01-03T11:00:00Z', // пізніший факт, надійшов першим
    });
    const deviceAResult = await deviceBWrite;
    expect(deviceAResult.cellIndex).toBe(3);

    const staleResult = await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 7,
      positionUpdatedAt: '2026-01-03T10:00:00Z', // раніший факт, надійшов другим (мережева затримка)
    });

    // Переможець -- пізніший факт (B, cellIndex 3), не порядок надходження (A, cellIndex 7).
    expect(staleResult.cellIndex).toBe(3);
    expect(positions.find((p) => p.card_id === CARD_ID)?.cell_index).toBe(3);
  });
});
