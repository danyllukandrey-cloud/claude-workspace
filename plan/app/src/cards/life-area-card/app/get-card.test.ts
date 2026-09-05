// Швидкий unit-тест (без мережі, без реального Postgres) -- підробляємо db
// через vi.fn(), що маршрутизує запит за текстом SQL до потрібного канонічного
// рядка (той самий підхід, що update-card.test.ts). Кожен DoD-пункт задачі T20
// (навіть написаний як "Integration test: ...") перекладений тут на unit-рівень.

import { describe, it, expect, vi } from 'vitest';
import { getCardWithProgress } from './get-card';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const CARD_ID = 'card-1';

/** Канонічний рядок таблиці `card`, як його повертає `pg` (snake_case). */
function cardRow(overrides: Partial<{ description: string | null }> = {}) {
  return {
    id: CARD_ID,
    owner_user_id: OWNER,
    name: 'Здоровʼя',
    description: overrides.description === undefined ? 'Хочу бути активнішим' : overrides.description,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Канонічний рядок таблиці `metric_block` -- NUMERIC (target_count) рядком, як з реального pg. */
function metricBlockRow(
  overrides: Partial<{ id: string; label: string; targetCount: number | null; isOngoing: boolean }> = {}
) {
  return {
    id: overrides.id ?? 'block-1',
    card_id: CARD_ID,
    label: overrides.label ?? 'Пробіжки',
    unit: 'разів',
    frequency: null,
    target_count: overrides.targetCount === undefined ? '12' : overrides.targetCount === null ? null : String(overrides.targetCount),
    is_ongoing: overrides.isOngoing ?? false,
    target_date: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Канонічний рядок таблиці `entry` -- amount рядком, як з реального pg. */
function entryRow(
  id: string,
  metricBlockId: string,
  amount: number,
  status: 'pending' | 'confirmed' | 'rejected' = 'confirmed'
) {
  return {
    id,
    metric_block_id: metricBlockId,
    card_id: CARD_ID,
    amount: String(amount),
    raw_text: null,
    status,
    source_device_id: null,
    recorded_at: new Date('2026-01-01T00:00:00Z'),
    confirmed_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база: маршрутизує запит за текстом SQL до потрібного канонічного
 * рядка -- лише `db.query` мокається, postgres-repo.ts (SQL-тексти, парсинг
 * NUMERIC) лишається справжнім, як і задумано DI (ADR-0004).
 */
function fakeDb(opts: {
  card: ReturnType<typeof cardRow> | null;
  metricBlocks?: ReturnType<typeof metricBlockRow>[];
  entriesByBlockId?: Record<string, ReturnType<typeof entryRow>[]>;
}): Db {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('FROM card WHERE')) {
      return { rows: opts.card ? [opts.card] : [] };
    }
    if (text.includes('FROM metric_block WHERE')) {
      return { rows: opts.metricBlocks ?? [] };
    }
    if (text.includes('FROM entry WHERE metric_block_id')) {
      const metricBlockId = params?.[0] as string;
      return { rows: opts.entriesByBlockId?.[metricBlockId] ?? [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('getCardWithProgress', () => {
  // AC-09: відповідь містить прогрес по кожному блоку + агрегат картки.
  it('returns per-block progress and the card aggregate (average share among bounded blocks)', async () => {
    const db = fakeDb({
      card: cardRow(),
      metricBlocks: [
        metricBlockRow({ id: 'block-1', targetCount: 12 }),
        metricBlockRow({ id: 'block-2', label: 'Читання', targetCount: 10 }),
      ],
      entriesByBlockId: {
        'block-1': [entryRow('e1', 'block-1', 2), entryRow('e2', 'block-1', 1)], // 3/12 = 0.25
        'block-2': [entryRow('e3', 'block-2', 5)], // 5/10 = 0.5
      },
    });

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID });

    expect(result.metricBlocks).toHaveLength(2);
    expect(result.metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 0.25, overGoal: 0 });
    expect(result.metricBlocks[1].progress).toMatchObject({ kind: 'bounded', share: 0.5, overGoal: 0 });
    expect(result.aggregateProgress).toBeCloseTo(0.375); // (0.25 + 0.5) / 2
  });

  // AC-09b: перевищення цілі -- capped share (<=1) + окремий overGoal > 0.
  // T6 (computeProgress) вже протестований окремо (domain/progress.test.ts) --
  // тут досить перевірити, що use-case прокидає результат як є, нічого не
  // обчислюючи по-своєму.
  it('passes through a capped share and separate overGoal amount when a block exceeds its target', async () => {
    const db = fakeDb({
      card: cardRow(),
      metricBlocks: [metricBlockRow({ id: 'block-1', targetCount: 10 })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 14)] },
    });

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID });

    expect(result.metricBlocks[0].progress).toMatchObject({ kind: 'bounded', share: 1, overGoal: 4 });
  });

  // AC-09/AC-05: ongoing-блоки не мають share (Critical flow 6) -- у середнє
  // не входять; немає жодного bounded-блоку -> агрегат null.
  it('excludes ongoing blocks from the aggregate and returns null when there is no bounded block', async () => {
    const db = fakeDb({
      card: cardRow(),
      metricBlocks: [metricBlockRow({ id: 'block-1', isOngoing: true, targetCount: null })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 6)] },
    });

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID });

    expect(result.metricBlocks[0].progress).toMatchObject({ kind: 'ongoing', accumulated: 6 });
    expect(result.aggregateProgress).toBeNull();
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка -- AppError('card.not_found', 404),
  // та сама форма, що й archive-card.ts/update-card.ts; жодного подальшого
  // читання блоків/записів не відбувається.
  it('throws card.not_found for a foreign or missing card without reading blocks or entries', async () => {
    const db = fakeDb({ card: null });

    await expect(getCardWithProgress(db, { ownerUserId: OWNER, cardId: 'not-mine' })).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    await expect(getCardWithProgress(db, { ownerUserId: OWNER, cardId: 'not-mine' })).rejects.toBeInstanceOf(AppError);
    expect(db.query).toHaveBeenCalledTimes(2); // два виклики expect вище -- по одному SELECT card кожен
  });

  // AC-10: callClaude передано і повертає непорожній рядок -> dataWarning заповнено,
  // з описом картки й короткими фактами (join записів) переданими в T12.
  it('fills dataWarning when an injected callClaude reports something suspicious', async () => {
    const db = fakeDb({
      card: cardRow({ description: 'Щотижневі пробіжки' }),
      metricBlocks: [metricBlockRow({ id: 'block-1', targetCount: 12 })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 2)] },
    });
    const callClaude = vi.fn().mockResolvedValue('Опис каже про щотижневі пробіжки, але записів замало.');

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID }, callClaude);

    expect(result.dataWarning).toBe('Опис каже про щотижневі пробіжки, але записів замало.');
    expect(callClaude).toHaveBeenCalledTimes(1);
    const [prompt] = callClaude.mock.calls[0] as [string];
    expect(prompt).toContain('Щотижневі пробіжки');
    expect(prompt).toContain('2 (confirmed)');
  });

  // AC-10: callClaude передано, але повертає '' (T12 нічого не знайшов) -> dataWarning null.
  it('leaves dataWarning null when an injected callClaude finds nothing suspicious', async () => {
    const db = fakeDb({
      card: cardRow(),
      metricBlocks: [metricBlockRow({ id: 'block-1', targetCount: 12 })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 2)] },
    });
    const callClaude = vi.fn().mockResolvedValue('');

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID }, callClaude);

    expect(result.dataWarning).toBeNull();
    expect(callClaude).toHaveBeenCalledTimes(1);
  });

  // AC-10 (той самий підхід, що closeStructurePosition в archive-card.ts): callClaude
  // НЕ передано -> dataWarning відсутній, і взагалі нема чого викликати -- без
  // посилання на callClaude в цьому виклику T12/Claude API фізично не досяжні.
  it('never touches dataWarning when callClaude is not provided', async () => {
    const db = fakeDb({
      card: cardRow(),
      metricBlocks: [metricBlockRow({ id: 'block-1', targetCount: 12 })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 2)] },
    });

    const result = await getCardWithProgress(db, { ownerUserId: OWNER, cardId: CARD_ID });

    expect(result.dataWarning).toBeNull();
  });
});
