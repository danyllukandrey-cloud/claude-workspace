// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), той самий
// підхід, що app/*.test.ts (get-card.test.ts, update-card.test.ts): postgres-repo.ts
// НЕ мокається, лише db.query, use-case-шар теж лишається справжнім -- тест
// перевіряє реальну композицію ports -> app -> infra аж до SQL-тексту, лише
// саме з'єднання підроблене (DI, ADR-0004).
//
// DoD T21: кожен код відповіді з contracts/openapi.yaml відтворено (201/200
// на успіх, 404 card.not_found, 422 card.name_required/card.description_required),
// 404 однаковий для "не існує" й "чуже" (різні ownerUserId в тесті).

import { describe, it, expect, vi } from 'vitest';
import { listCards, createCard, getCard, updateCard, archiveCard, restoreCard } from './card-handlers';
import { AppError } from '../../../shared/errors';
import { CardValidationError } from '../domain/card';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const CARD_ID = 'card-1';

/** Канонічний рядок таблиці `card`, як його повертає `pg` (snake_case). */
function cardRow(
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    status: 'active' | 'archived';
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? CARD_ID,
    owner_user_id: OWNER,
    name: overrides.name ?? 'Спорт',
    description: overrides.description === undefined ? null : overrides.description,
    status: overrides.status ?? 'active',
    created_at: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updated_at: overrides.updatedAt ?? new Date('2026-01-02T00:00:00Z'),
  };
}

const LIFECYCLE_ROW = {
  id: 'event-1',
  card_id: CARD_ID,
  transition: 'created',
  occurred_at: new Date('2026-01-01T00:00:00Z'),
};

// --- listCards --------------------------------------------------------------

describe('listCards handler', () => {
  const CARD_1 = cardRow({ id: 'card-1', createdAt: new Date('2026-01-01T00:00:00Z') }); // найстаріша
  const CARD_2 = cardRow({ id: 'card-2', createdAt: new Date('2026-01-02T00:00:00Z') });
  const CARD_3 = cardRow({ id: 'card-3', createdAt: new Date('2026-01-03T00:00:00Z') }); // найновіша

  // listActiveCardsByOwner (postgres-repo.ts) не сортує -- перевіряємо, що
  // хендлер сам впорядковує (найновіша перша) ПЕРЕД різанням на сторінки.
  it('sorts newest-first and paginates by limit, reporting has_next/next_cursor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1, CARD_3, CARD_2] }); // навмисно не по порядку
    const db: Db = { query };

    const page = await listCards(db, OWNER, { limit: 2 });

    expect(page.items.map((c) => c.id)).toEqual(['card-3', 'card-2']);
    expect(page.has_next).toBe(true);
    expect(page.has_prev).toBe(false);
    expect(page.next_cursor).toBe('card-2');
  });

  // Продовження з курсором попередньої сторінки -- остання сторінка.
  it('continues from the after cursor to the last page', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1, CARD_2, CARD_3] });
    const db: Db = { query };

    const page = await listCards(db, OWNER, { after: 'card-2', limit: 2 });

    expect(page.items.map((c) => c.id)).toEqual(['card-1']);
    expect(page.has_next).toBe(false);
    expect(page.has_prev).toBe(true);
    expect(page.next_cursor).toBeNull();
  });

  // Курсор, якого немає в поточному списку (картку архівували/видалили між
  // запитами) -- контракт не визначає код помилки, трактуємо як невалідний і
  // читаємо з початку (лінієнтна поведінка, задокументовано в card-handlers.ts).
  it('falls back to the start of the list for an unknown cursor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1, CARD_2, CARD_3] });
    const db: Db = { query };

    const page = await listCards(db, OWNER, { after: 'not-in-the-list', limit: 2 });

    expect(page.items.map((c) => c.id)).toEqual(['card-3', 'card-2']);
    expect(page.has_prev).toBe(false);
  });

  // Clamp на нижній межі (limit=0 -> 1) -- без clamp це повернуло б 0 елементів.
  it('clamps a below-minimum limit up to 1', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1, CARD_2, CARD_3] });
    const db: Db = { query };

    const page = await listCards(db, OWNER, { limit: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe('card-3');
  });

  // AC-18: status='archived' викликає іншу SQL-гілку.
  it('forwards status=archived to the archived-cards branch', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1] });
    const db: Db = { query };

    await listCards(db, OWNER, { status: 'archived' });

    expect(query.mock.calls[0][0]).toContain("status = 'archived'");
  });

  // sortCardsForPaging застосовується ОДНАКОВО до обох гілок -- навіть попри
  // те, що listArchivedCardsByOwner уже сортує на рівні SQL (updated_at DESC),
  // курсор пагінації спирається на ОДИН порядок (createdAt DESC) для обох
  // статусів (закриває нит критика хвилі 6: раніше цю гілку тестували лише на
  // SQL-текст, не на реальне сортування вхідних рядків).
  it('re-sorts newest-first on the archived branch too, regardless of row order from the repo', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1, CARD_3, CARD_2] }); // навмисно не по порядку
    const db: Db = { query };

    const page = await listCards(db, OWNER, { status: 'archived' });

    expect(page.items.map((c) => c.id)).toEqual(['card-3', 'card-2', 'card-1']);
  });

  // Default (без query взагалі) -- та сама SQL-гілка, що status='active' явно.
  it('defaults to the active branch with no query object', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const page = await listCards(db, OWNER);

    expect(query.mock.calls[0][0]).toContain("status = 'active'");
    expect(page).toEqual({ items: [], has_next: false, has_prev: false, next_cursor: null });
  });

  // Форма DTO -- camelCase, ownerUserId відсіяно, aggregateProgress/dataWarning
  // відсутні (listCards не рахує прогрес).
  it('maps each item to the Card DTO shape without ownerUserId or progress fields', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_1] });
    const db: Db = { query };

    const page = await listCards(db, OWNER);

    expect(page.items[0]).toEqual({
      id: 'card-1',
      name: 'Спорт',
      description: null,
      status: 'active',
      createdAt: CARD_1.created_at.toISOString(),
      updatedAt: CARD_1.updated_at.toISOString(),
    });
  });
});

// --- createCard ---------------------------------------------------------------

describe('createCard handler', () => {
  // 201 happy path (AC-01/AC-02).
  it('creates a card and returns the Card DTO', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [cardRow({ name: 'Спорт' })] })
      .mockResolvedValueOnce({ rows: [LIFECYCLE_ROW] });
    const db: Db = { query };

    const result = await createCard(db, OWNER, { name: 'Спорт' });

    expect(result).toEqual({
      id: CARD_ID,
      name: 'Спорт',
      description: null,
      status: 'active',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(result).not.toHaveProperty('aggregateProgress');
    expect(result).not.toHaveProperty('dataWarning');
  });

  // 422 card.name_required (AC-02) -- домен кидає CardValidationError сам,
  // хендлер пропускає як є (НЕ AppError, той самий формат {code, message}).
  it('lets a blank name reject as CardValidationError with card.name_required, not AppError', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(createCard(db, OWNER, { name: '   ' })).rejects.toBeInstanceOf(CardValidationError);
    await expect(createCard(db, OWNER, { name: '' })).rejects.toMatchObject({ code: 'card.name_required' });
    const error = await createCard(db, OWNER, { name: '' }).catch((e) => e);
    expect(error).not.toBeInstanceOf(AppError);
    expect(query).not.toHaveBeenCalled();
  });
});

// --- getCard -----------------------------------------------------------------

function metricBlockRow(overrides: Partial<{ id: string; targetCount: number | null }> = {}) {
  return {
    id: overrides.id ?? 'block-1',
    card_id: CARD_ID,
    label: 'Пробіжки',
    unit: 'разів',
    frequency: null,
    target_count: overrides.targetCount === undefined ? '10' : overrides.targetCount === null ? null : String(overrides.targetCount),
    is_ongoing: false,
    target_date: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function entryRow(id: string, metricBlockId: string, amount: number) {
  return {
    id,
    metric_block_id: metricBlockId,
    card_id: CARD_ID,
    amount: String(amount),
    raw_text: null,
    status: 'confirmed' as const,
    source_device_id: null,
    recorded_at: new Date('2026-01-01T00:00:00Z'),
    confirmed_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Маршрутизує запит за текстом SQL -- той самий підхід, що app/get-card.test.ts. */
function fakeGetCardDb(opts: {
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

describe('getCard handler', () => {
  // 200 happy path -- AC-09: aggregateProgress рахується, dataWarning null
  // без переданого callClaude, і metricBlocks НЕ входить у відповідь (ISS-39).
  it('maps card + aggregateProgress + dataWarning into the Card DTO, without metricBlocks', async () => {
    const db = fakeGetCardDb({
      card: cardRow(),
      metricBlocks: [metricBlockRow({ targetCount: 10 })],
      entriesByBlockId: { 'block-1': [entryRow('e1', 'block-1', 5)] }, // 5/10 = 0.5
    });

    const result = await getCard(db, OWNER, CARD_ID);

    expect(result).toEqual({
      id: CARD_ID,
      name: 'Спорт',
      description: null,
      status: 'active',
      aggregateProgress: 0.5,
      dataWarning: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(result).not.toHaveProperty('metricBlocks');
  });

  // 404 card.not_found -- та сама форма для "не існує" й "чуже" (AC-04),
  // перевірено з різними ownerUserId.
  it('returns the identical 404 for a missing card and for another user\'s card', async () => {
    const missingDb = fakeGetCardDb({ card: null });
    const foreignDb = fakeGetCardDb({ card: null }); // repo сам фільтрує owner+id, чужа картка теж дає null

    const missingError = await getCard(missingDb, 'owner-a', 'nonexistent-card').catch((e) => e);
    const foreignError = await getCard(foreignDb, 'owner-b', CARD_ID).catch((e) => e);

    expect(missingError).toBeInstanceOf(AppError);
    expect(foreignError).toBeInstanceOf(AppError);
    expect(missingError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(foreignError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(missingError.message).toBe(foreignError.message);
  });
});

// --- updateCard ----------------------------------------------------------------

/** Маршрутизує запит за текстом SQL -- той самий підхід, що app/update-card.test.ts. */
function fakeUpdateCardDb(opts: { current: ReturnType<typeof cardRow> | null; updated?: ReturnType<typeof cardRow> }): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.startsWith('SELECT')) {
      return { rows: opts.current ? [opts.current] : [] };
    }
    if (text.startsWith('UPDATE card')) {
      return { rows: opts.updated ? [opts.updated] : [] };
    }
    if (text.startsWith('INSERT INTO card_lifecycle_event')) {
      return { rows: [LIFECYCLE_ROW] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('updateCard handler', () => {
  // 200 happy path (AC-02/AC-19) -- часткове оновлення назви, без прогресу в DTO.
  it('updates the card and returns the Card DTO without progress fields', async () => {
    const db = fakeUpdateCardDb({
      current: cardRow({ name: 'Спорт' }),
      updated: cardRow({ name: 'Біг' }),
    });

    const result = await updateCard(db, OWNER, CARD_ID, { name: 'Біг' });

    expect(result.name).toBe('Біг');
    expect(result).not.toHaveProperty('aggregateProgress');
    expect(result).not.toHaveProperty('dataWarning');
  });

  // 422 card.description_required (AC-03) -- домен кидає CardValidationError
  // сам, ДО будь-якого UPDATE, пропускаємо як є.
  it('lets markFilled without a description reject as CardValidationError, not AppError', async () => {
    const db = fakeUpdateCardDb({ current: cardRow({ description: null }) });

    await expect(updateCard(db, OWNER, CARD_ID, { markFilled: true })).rejects.toBeInstanceOf(CardValidationError);
    const error = await updateCard(db, OWNER, CARD_ID, { markFilled: true }).catch((e) => e);
    expect(error).toMatchObject({ code: 'card.description_required' });
    expect(error).not.toBeInstanceOf(AppError);
  });

  // 404 card.not_found -- та сама форма для "не існує" й "чуже" (AC-04).
  it('returns the identical 404 for a missing card and for another user\'s card', async () => {
    const missingDb = fakeUpdateCardDb({ current: null });
    const foreignDb = fakeUpdateCardDb({ current: null });

    const missingError = await updateCard(missingDb, 'owner-a', 'nonexistent-card', { name: 'X' }).catch((e) => e);
    const foreignError = await updateCard(foreignDb, 'owner-b', CARD_ID, { name: 'X' }).catch((e) => e);

    expect(missingError).toBeInstanceOf(AppError);
    expect(foreignError).toBeInstanceOf(AppError);
    expect(missingError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(foreignError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
  });

  // D-103/D-115 (ISS-105): recordRenameEvent -- опційна ін'єкція, той самий
  // підхід, що closeStructurePosition в archiveCard. Порт лише прокидає її
  // далі в use-case.
  it('threads an optional recordRenameEvent callback through to the use-case', async () => {
    const db = fakeUpdateCardDb({
      current: cardRow({ name: 'Спорт' }),
      updated: cardRow({ name: 'Біг' }),
    });
    const recordRenameEvent = vi.fn().mockResolvedValue(undefined);

    await updateCard(db, OWNER, CARD_ID, { name: 'Біг' }, recordRenameEvent);

    expect(recordRenameEvent).toHaveBeenCalledWith(db, OWNER, CARD_ID, 'Біг');
  });
});

// --- archiveCard ---------------------------------------------------------------

describe('archiveCard handler', () => {
  // 200 happy path (AC-16).
  it('archives the card and returns the Card DTO', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [cardRow({ status: 'archived' })] })
      .mockResolvedValueOnce({ rows: [{ ...LIFECYCLE_ROW, transition: 'archived' }] });
    const db: Db = { query };

    const result = await archiveCard(db, OWNER, CARD_ID);

    expect(result.status).toBe('archived');
    expect(result).not.toHaveProperty('aggregateProgress');
  });

  // 404 card.not_found -- та сама форма для "не існує" й "чуже" (AC-04).
  it('returns the identical 404 for a missing card and for another user\'s card', async () => {
    const missingQuery = vi.fn().mockResolvedValue({ rows: [] });
    const foreignQuery = vi.fn().mockResolvedValue({ rows: [] });

    const missingError = await archiveCard({ query: missingQuery }, 'owner-a', 'nonexistent-card').catch((e) => e);
    const foreignError = await archiveCard({ query: foreignQuery }, 'owner-b', CARD_ID).catch((e) => e);

    expect(missingError).toBeInstanceOf(AppError);
    expect(foreignError).toBeInstanceOf(AppError);
    expect(missingError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(foreignError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
  });

  // D-69/D-103: closeStructurePosition -- опційна ін'єкція, той самий підхід,
  // що callClaude в getCard. Порт лише прокидає її далі в use-case (закриває
  // should-fix критика хвилі 6 -- раніше цього параметра не було в сигнатурі
  // порту взагалі, T30 не мав би як його підключити).
  it('threads an optional closeStructurePosition callback through to the use-case', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [cardRow({ status: 'archived' })] })
      .mockResolvedValueOnce({ rows: [{ ...LIFECYCLE_ROW, transition: 'archived' }] });
    const db: Db = { query };
    const closeStructurePosition = vi.fn().mockResolvedValue(undefined);

    await archiveCard(db, OWNER, CARD_ID, closeStructurePosition);

    expect(closeStructurePosition).toHaveBeenCalledWith(db, CARD_ID);
  });
});

// --- restoreCard (T35) -----------------------------------------------------

/** Маршрутизує запит за текстом SQL -- той самий підхід, що app/restore-card.test.ts. */
function fakeRestoreCardDb(opts: { current: ReturnType<typeof cardRow> | null; restored?: ReturnType<typeof cardRow> }): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.startsWith('SELECT')) {
      return { rows: opts.current ? [opts.current] : [] };
    }
    if (text.startsWith('UPDATE card')) {
      return { rows: opts.restored ? [opts.restored] : [] };
    }
    if (text.startsWith('INSERT INTO card_lifecycle_event')) {
      return { rows: [{ ...LIFECYCLE_ROW, transition: 'restored' }] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('restoreCard handler', () => {
  // 200 happy path (AC-17) -- дзеркало archiveCard.
  it('restores an archived card and returns the Card DTO', async () => {
    const db = fakeRestoreCardDb({
      current: cardRow({ status: 'archived' }),
      restored: cardRow({ status: 'active' }),
    });

    const result = await restoreCard(db, OWNER, CARD_ID);

    expect(result.status).toBe('active');
    expect(result).not.toHaveProperty('aggregateProgress');
  });

  // 404 card.not_found -- та сама форма для "не існує" й "чуже" (AC-04).
  it('returns the identical 404 for a missing card and for another user\'s card', async () => {
    const missingDb = fakeRestoreCardDb({ current: null });
    const foreignDb = fakeRestoreCardDb({ current: null });

    const missingError = await restoreCard(missingDb, 'owner-a', 'nonexistent-card').catch((e) => e);
    const foreignError = await restoreCard(foreignDb, 'owner-b', CARD_ID).catch((e) => e);

    expect(missingError).toBeInstanceOf(AppError);
    expect(foreignError).toBeInstanceOf(AppError);
    expect(missingError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(foreignError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
  });

  // 409 card.not_archived -- картка існує й належить користувачу, але вже активна.
  it('returns 409 card.not_archived for an already-active card', async () => {
    const db = fakeRestoreCardDb({ current: cardRow({ status: 'active' }) });

    const error = await restoreCard(db, OWNER, CARD_ID).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'card.not_archived', httpStatus: 409 });
  });
});
