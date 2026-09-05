import { describe, it, expect, vi } from 'vitest';
import { updateCard } from './update-card';
import { AppError } from '../../../shared/errors';
import { CardValidationError } from '../domain/card';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const CARD_ID = 'card-1';

/** Канонічний рядок таблиці `card`, як його повертає `pg` (snake_case). */
function cardRow(overrides: Partial<{ name: string; description: string | null; status: 'active' | 'archived' }> = {}) {
  return {
    id: CARD_ID,
    owner_user_id: OWNER,
    name: overrides.name ?? 'Здоровʼя',
    description: overrides.description ?? null,
    status: overrides.status ?? 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база: маршрутизує запит за текстом SQL до потрібного канонічного
 * рядка -- без мережі, без реальних postgres-repo internals, окрім самого
 * postgres-repo.ts (він не мокається, лише `db.query`, як і задумано DI).
 */
function fakeDb(opts: { current: ReturnType<typeof cardRow> | null; updated?: ReturnType<typeof cardRow> }): Db {
  // `Db['query']` — дженерик за поверненим типом (T не виводиться з аргументів),
  // тому мок пишемо без анотації дженерика й приводимо цілий метод типом нижче --
  // так само безпечно на межі тесту, як `as unknown as T[]` було б усередині кожної гілки.
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.startsWith('SELECT')) {
      return { rows: opts.current ? [opts.current] : [] };
    }
    if (text.startsWith('UPDATE card')) {
      return { rows: opts.updated ? [opts.updated] : [] };
    }
    if (text.startsWith('INSERT INTO card_lifecycle_event')) {
      return { rows: [{ id: 'event-1', card_id: CARD_ID, transition: 'filled', occurred_at: new Date() }] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('updateCard', () => {
  // DoD T14: markFilled:true без Опису ніде (ні збереженого, ні в патчі) --
  // помилка ДО будь-якого UPDATE-запиту.
  it('rejects markFilled without a description anywhere, before any UPDATE query', async () => {
    const db = fakeDb({ current: cardRow({ description: null }) });

    await expect(updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, markFilled: true })).rejects.toThrow(
      CardValidationError
    );

    // Лише SELECT (findCardById) -- жодного UPDATE не пішло.
    expect(db.query).toHaveBeenCalledTimes(1);
    const [calledText] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(calledText.startsWith('SELECT')).toBe(true);
  });

  it('rejects markFilled when the description in the same call is blank whitespace', async () => {
    const db = fakeDb({ current: cardRow({ description: null }) });

    await expect(
      updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, description: '   ', markFilled: true })
    ).rejects.toThrow(CardValidationError);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  // Опис зберігається окремо від позначення "заповнена" -- без markFilled
  // жодної lifecycle-події не пишеться.
  it('saves the description on its own, independent of markFilled', async () => {
    const db = fakeDb({
      current: cardRow({ description: null }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });

    const result = await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, description: 'Хочу бути активнішим' });

    expect(result.description).toBe('Хочу бути активнішим');
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([text]) => text.startsWith('UPDATE card'))).toBe(true);
    expect(calls.some(([text]) => text.startsWith('INSERT INTO card_lifecycle_event'))).toBe(false);
  });

  // AC-03 happy path: Опис уже збережений раніше -- markFilled проходить
  // без потреби передавати Опис знову в цьому ж виклику.
  it('accepts markFilled when the description was already saved earlier', async () => {
    const db = fakeDb({
      current: cardRow({ description: 'Хочу бути активнішим' }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });

    const result = await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, markFilled: true });

    expect(result.description).toBe('Хочу бути активнішим');
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([text]) => text.startsWith('INSERT INTO card_lifecycle_event'))).toBe(true);
  });

  // AC-03 happy path: Опис переданий у ТОМУ Ж виклику, що й markFilled.
  it('accepts markFilled when the description is passed in the same call', async () => {
    const db = fakeDb({
      current: cardRow({ description: null }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });

    const result = await updateCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      description: 'Хочу бути активнішим',
      markFilled: true,
    });

    expect(result.description).toBe('Хочу бути активнішим');
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([text]) => text.startsWith('INSERT INTO card_lifecycle_event'))).toBe(true);
  });

  // Non-disclosure (AC-04): чужа й неіснуюча картка виглядають однаково --
  // AppError('card.not_found', 404), без жодного UPDATE.
  it('rejects a foreign or missing card as card.not_found, without attempting an UPDATE', async () => {
    const db = fakeDb({ current: null });

    await expect(updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, name: 'Нова назва' })).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a foreign or missing card as AppError specifically', async () => {
    const db = fakeDb({ current: null });

    await expect(updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, name: 'Нова назва' })).rejects.toBeInstanceOf(
      AppError
    );
  });
});
