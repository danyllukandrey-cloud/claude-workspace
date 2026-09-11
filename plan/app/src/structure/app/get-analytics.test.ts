// T14 -- App: getAnalytics use-case.
// RED (unit level, mocked Db + injected `getCardProgress` -- test-plan.md marks
// AC-01/AC-05/AC-07 as "integration" and AC-04/AC-06/AC-06b/AC-13 as "unit";
// Docker/Neon are unavailable in this sandbox, so ./get-analytics.integration.test.ts
// (same file next to this one) is expected NON-red there -- this file is the
// one that must be GOOD red locally and stays the TDD loop for the whole AC set.
//
// Contract this test defines for the not-yet-written production code
// (sad.md §6 Critical flows 1/9/10, ADR-0001 "never cache the aggregate --
// recompute from raw card data every time"):
//
//   getAnalytics(db, { ownerUserId, asOf? }, getCardProgress) -> StructureAnalyticsResult
//
// - `db` -- the same `Db` contract as ../infra/postgres-repo.ts (query(text, params) -> {rows}).
// - `getCardProgress(cardId)` -- injected, the same pattern as get-card.ts's `callClaude`:
//   the ONLY source of a card's progress/hasMetricBlock/entryCount. getAnalytics never
//   reads or stores its own copy of a card's progress number (AC-05) -- it asks this
//   callback fresh, every single call, and the composition root (ports layer, T16) is
//   the one that wires it to `life-area-card`'s own getCardWithProgress use-case, so
//   the number can never independently disagree with what the card's own screen shows.
// - Orchestration: reads the owner's Structure (layoutMode) + active layout positions
//   (T9's infra/postgres-repo.ts), asks getCardProgress for each, then feeds the results
//   into T6/T7's pure domain functions (../domain/aggregate.ts) -- computeStructureAggregate
//   (AC-01/AC-04/AC-13), and either computeLogicLayoutGaps (AC-06, layoutMode 'logic') or
//   flagUnmaintainedCards (AC-06b, layoutMode 'single'/'free'/null).
// - Trend (AC-07): reconstructs each card's PAST cellIndex from T10's
//   infra/history-repo.ts findHistoryEventsAsOf (the latest 'moved' event with
//   occurred_at <= asOf), parsing `detail` in the "cell_index -> N" shape already
//   used by ../infra/history-repo.test.ts's fixture -- the only shape currently in
//   use anywhere in this codebase, since data-model.md leaves the exact `detail`
//   format TBD. No past 'moved' event for a card (asOf before any history, or a
//   card that never moved) -- that card's trend is `null`, not an error (T14 DoD's
//   3rd bullet: "відсутність подій ... не валить весь виклик").

import { describe, it, expect, vi } from 'vitest';
import { getAnalytics } from './get-analytics';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function structureRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: STRUCTURE_ID,
    owner_user_id: OWNER,
    declaration: null,
    layout_mode: 'free',
    logic_variant: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function positionRow(cardId: string, cellIndex: number) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    cell_index: cellIndex,
    status: 'active' as const,
    position_updated_at: new Date('2026-01-02T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function historyRow(cardId: string, detail: string, occurredAt: string) {
  return {
    id: `history-${cardId}-${occurredAt}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    event_type: 'moved' as const,
    detail,
    occurred_at: new Date(occurredAt),
  };
}

/**
 * Fake Db -- routes by SQL text, same convention as ./move-card.test.ts and
 * ../infra/*.test.ts. None of the real infra functions
 * (findStructureByOwner/listActiveLayoutPositionsByOwner/findHistoryEventsAsOf)
 * are mocked themselves -- only the `db.query` boundary, so this test exercises
 * the real SQL-shaping code, not a stand-in for it.
 */
function fakeDb(opts: {
  structure?: ReturnType<typeof structureRow> | null;
  positions: ReturnType<typeof positionRow>[];
  history?: ReturnType<typeof historyRow>[];
}): Db {
  const query = vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('FROM structure_history_event') && sql.startsWith('SELECT')) {
      return { rows: opts.history ?? [] };
    }
    if (text.includes('structure_layout_position') && text.includes('JOIN structure')) {
      return { rows: opts.positions };
    }
    if (text.includes('FROM structure WHERE owner_user_id')) {
      return { rows: opts.structure === null ? [] : [opts.structure ?? structureRow()] };
    }

    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });

  return { query: query as unknown as Db['query'] };
}

describe('getAnalytics -- AC-01/AC-13: average across computable cards, excluded count shown separately', () => {
  it('averages only cards with a computable progress percentage', async () => {
    const db = fakeDb({
      positions: [positionRow('card-1', 0), positionRow('card-2', 1), positionRow('card-3', 2)],
    });
    const progressByCard: Record<string, { progress: number | null; hasMetricBlock: boolean; entryCount: number }> = {
      'card-1': { progress: 0.2, hasMetricBlock: true, entryCount: 3 },
      'card-2': { progress: 0.8, hasMetricBlock: true, entryCount: 5 },
      'card-3': { progress: null, hasMetricBlock: true, entryCount: 4 }, // AC-13: ongoing, no denominator
    };
    const getCardProgress = vi.fn(async (cardId: string) => progressByCard[cardId]);

    const result = await getAnalytics(db, { ownerUserId: OWNER }, getCardProgress);

    expect(result.average).toBeCloseTo(0.5);
    expect(result.excludedCount).toBe(1);
  });
});

describe('getAnalytics -- AC-04: layout position never changes the aggregate', () => {
  it('produces the identical average when the same cards sit at different cellIndex values', async () => {
    const progressByCard: Record<string, { progress: number | null; hasMetricBlock: boolean; entryCount: number }> = {
      'card-1': { progress: 0.1, hasMetricBlock: true, entryCount: 1 },
      'card-2': { progress: 0.9, hasMetricBlock: true, entryCount: 1 },
    };
    const getCardProgress = vi.fn(async (cardId: string) => progressByCard[cardId]);

    const dbOriginal = fakeDb({ positions: [positionRow('card-1', 5), positionRow('card-2', 0)] });
    const dbReordered = fakeDb({ positions: [positionRow('card-2', 99), positionRow('card-1', 1)] });

    const original = await getAnalytics(dbOriginal, { ownerUserId: OWNER }, getCardProgress);
    const reordered = await getAnalytics(dbReordered, { ownerUserId: OWNER }, getCardProgress);

    expect(reordered.average).toBe(original.average);
    expect(original.average).toBeCloseTo(0.5);
  });
});

describe('getAnalytics -- AC-06: logic-layout gap (rank vs progress, no verdict)', () => {
  it('attaches, per card, the position-derived rank gap and no good/bad verdict field', async () => {
    const db = fakeDb({
      structure: structureRow({ layout_mode: 'logic' }),
      positions: [positionRow('card-top', 0), positionRow('card-mid', 1), positionRow('card-bottom', 2)],
    });
    const progressByCard: Record<string, { progress: number | null; hasMetricBlock: boolean; entryCount: number }> = {
      'card-top': { progress: 0.9, hasMetricBlock: true, entryCount: 9 },
      'card-mid': { progress: 0.5, hasMetricBlock: true, entryCount: 5 },
      'card-bottom': { progress: 0.1, hasMetricBlock: true, entryCount: 1 },
    };
    const getCardProgress = vi.fn(async (cardId: string) => progressByCard[cardId]);

    const result = await getAnalytics(db, { ownerUserId: OWNER }, getCardProgress);

    expect(result.layoutMode).toBe('logic');
    const byId = Object.fromEntries(result.cards.map((c: any) => [c.cardId, c]));
    expect(byId['card-top'].gap).toBeCloseTo(0.1); // rank 1 - progress 0.9, same formula as domain/aggregate.ts
    expect(byId['card-mid'].gap).toBeCloseTo(0);
    expect(byId['card-bottom'].gap).toBeCloseTo(-0.1);

    for (const card of result.cards) {
      expect(card).not.toHaveProperty('verdict');
      expect(card).not.toHaveProperty('label');
    }
  });
});

describe('getAnalytics -- AC-06b: no-scheme layout flags declared-but-unmaintained cards instead of a rank gap', () => {
  it('sets gap to null and flags only cards with a metric-block and zero entries', async () => {
    const db = fakeDb({
      structure: structureRow({ layout_mode: 'free' }),
      positions: [positionRow('card-idle', 0), positionRow('card-active', 1)],
    });
    const progressByCard: Record<string, { progress: number | null; hasMetricBlock: boolean; entryCount: number }> = {
      'card-idle': { progress: null, hasMetricBlock: true, entryCount: 0 },
      'card-active': { progress: 0.4, hasMetricBlock: true, entryCount: 3 },
    };
    const getCardProgress = vi.fn(async (cardId: string) => progressByCard[cardId]);

    const result = await getAnalytics(db, { ownerUserId: OWNER }, getCardProgress);

    const byId = Object.fromEntries(result.cards.map((c: any) => [c.cardId, c]));
    expect(byId['card-idle'].gap).toBeNull();
    expect(byId['card-active'].gap).toBeNull();
    expect(byId['card-idle'].unmaintained).toBe(true);
    expect(byId['card-active'].unmaintained).toBe(false);
  });
});

describe('getAnalytics -- AC-05: reflects a just-corrected card entry, never a separately cached number', () => {
  it('calls getCardProgress fresh on every invocation and reflects its latest return value', async () => {
    const db = fakeDb({ positions: [positionRow('card-1', 0)] });
    let currentProgress = 0.3;
    const getCardProgress = vi.fn(async () => ({ progress: currentProgress, hasMetricBlock: true, entryCount: 1 }));

    const before = await getAnalytics(db, { ownerUserId: OWNER }, getCardProgress);
    expect(before.average).toBeCloseTo(0.3);

    // Simulates life-area-card AC-12 (a corrected/rolled-back entry) happening
    // between the two reads -- no cache anywhere in getAnalytics should hide it.
    currentProgress = 0.9;
    const after = await getAnalytics(db, { ownerUserId: OWNER }, getCardProgress);

    expect(after.average).toBeCloseTo(0.9);
    expect(getCardProgress).toHaveBeenCalledTimes(2);
  });
});

describe('getAnalytics -- AC-07: gap trend uses the history-log asOf read', () => {
  it('derives "growing"/"shrinking" from a past moved-event position compared with the current one', async () => {
    const asOf = new Date('2026-01-05T00:00:00Z');
    const db = fakeDb({
      structure: structureRow({ layout_mode: 'logic' }),
      // Two cards now: card-1 at cellIndex 0 (top, rank 1), card-2 at cellIndex 1 (rank 0).
      positions: [positionRow('card-1', 0), positionRow('card-2', 1)],
      // card-1 used to sit at the bottom cell (rank 0) before `asOf` -- its rank rose,
      // so with an unchanged progress the (rank - progress) gap grew.
      history: [historyRow('card-1', 'cell_index -> 1', '2026-01-02T00:00:00Z')],
    });
    const progressByCard: Record<string, { progress: number | null; hasMetricBlock: boolean; entryCount: number }> = {
      'card-1': { progress: 0.2, hasMetricBlock: true, entryCount: 2 },
      'card-2': { progress: 0.2, hasMetricBlock: true, entryCount: 2 },
    };
    const getCardProgress = vi.fn(async (cardId: string) => progressByCard[cardId]);

    const result = await getAnalytics(db, { ownerUserId: OWNER, asOf }, getCardProgress);

    const card1 = result.cards.find((c: any) => c.cardId === 'card-1');
    expect(card1?.trend).toBe('growing');

    // T14 DoD bullet 3: a card with no history before `asOf` never throws -- trend
    // is simply reported unavailable (null), the rest of the analytics still returns.
    const card2 = result.cards.find((c: any) => c.cardId === 'card-2');
    expect(card2?.trend).toBeNull();
    expect(result.average).not.toBeNull();
  });

  it('reports every trend as null (never throws) when no history exists before asOf', async () => {
    const db = fakeDb({
      structure: structureRow({ layout_mode: 'logic' }),
      positions: [positionRow('card-1', 0)],
      history: [],
    });
    const getCardProgress = vi.fn(async () => ({ progress: 0.5, hasMetricBlock: true, entryCount: 1 }));

    const result = await getAnalytics(
      db,
      { ownerUserId: OWNER, asOf: new Date('2020-01-01T00:00:00Z') },
      getCardProgress
    );

    expect(result.cards.every((c: any) => c.trend === null)).toBe(true);
    expect(result.average).not.toBeNull();
  });
});
