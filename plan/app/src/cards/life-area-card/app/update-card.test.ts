import { describe, it, expect, vi } from 'vitest';
import { updateCard } from './update-card';
import { AppError } from '../../../shared/errors';
import { CardValidationError } from '../domain/card';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const CARD_ID = 'card-1';

/** Канонічний рядок таблиці `card`, як його повертає `pg` (snake_case). */
function cardRow(
  overrides: Partial<{
    name: string;
    description: string | null;
    status: 'active' | 'archived';
    tracking_mode: 'state' | 'ongoing' | 'goals';
    health_state: 'active' | 'critical' | 'paused' | null;
  }> = {}
) {
  return {
    id: CARD_ID,
    owner_user_id: OWNER,
    name: overrides.name ?? 'Здоровʼя',
    description: overrides.description ?? null,
    status: overrides.status ?? 'active',
    tracking_mode: overrides.tracking_mode ?? 'goals',
    health_state: overrides.health_state ?? null,
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

  // AC-03: Опис уже збережений раніше -- markFilled проходить без потреби
  // передавати Опис знову в цьому ж виклику (домен усе одно валідує проти
  // current.description).
  //
  // Review-fix (CH-06, docs/features/life-area-card/changes.md): цей тест
  // РАНІШЕ очікував INSERT INTO card_lifecycle_event навіть коли Опис УЖЕ
  // був непорожнім ДО виклику -- та сама ситуація, яку guard нижче
  // ("does not record... on an already-filled card") вважає "вже заповнена,
  // не справжній перехід" для recordAction. insertLifecycleEvent мав той
  // самий guard узгоджено -- тепер має (той самий review-fix).
  it('accepts markFilled without inserting a duplicate lifecycle event when the description was already saved earlier', async () => {
    const db = fakeDb({
      current: cardRow({ description: 'Хочу бути активнішим' }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });

    const result = await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, markFilled: true });

    expect(result.description).toBe('Хочу бути активнішим');
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([text]) => text.startsWith('INSERT INTO card_lifecycle_event'))).toBe(false);
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

  // Лог дій (кінець-сесії ревю виявив): справжній перехід "порожньо -> заповнено"
  // пише рядок у Лог дій.
  it('records a "Заповнено опис" action log entry on a genuine empty-to-filled transition', async () => {
    const db = fakeDb({
      current: cardRow({ description: null }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updateCard(
      db,
      { ownerUserId: OWNER, cardId: CARD_ID, description: 'Хочу бути активнішим', markFilled: true },
      undefined,
      recordAction
    );

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(db, { ownerUserId: OWNER, action: 'Заповнено опис картки «Здоровʼя»' });
  });

  // Той самий фікс: повторний markFilled:true на вже заповненій картці (UI
  // дозволяє знову відкрити опис і ще раз натиснути "заповнено") НЕ мав би
  // писати другий, оманливий рядок у Лог дій -- реального переходу не було.
  //
  // Review-fix (CH-06, docs/features/life-area-card/changes.md): guard
  // раніше стояв ЛИШЕ на recordAction -- сам card_lifecycle_event (append-
  // only audit-журнал, spec.md §7 KPI) писав "filled" щоразу без нього.
  // Рідкісний край-випадок до CH-06 (ручний чекбокс) -- CH-06 зробив
  // markFilled похідним від "Опис непорожній", тож без guard тут кожне
  // перейменування вже заповненої картки писало б повторний "filled".
  it('does not record a lifecycle "filled" event or an action log entry when markFilled is repeated on an already-filled card', async () => {
    const db = fakeDb({
      current: cardRow({ description: 'Хочу бути активнішим' }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, markFilled: true }, undefined, recordAction);

    expect(recordAction).not.toHaveBeenCalled();
    // Лише SELECT (findCardById) + UPDATE card -- жоден INSERT INTO
    // card_lifecycle_event не пішов (fakeDb кинув би на непередбачений
    // запит, якби пішов якийсь інший; тут перевіряємо явно, що їх рівно 2).
    expect(db.query).toHaveBeenCalledTimes(2);
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

  // AC-15/D-103/D-115 (закриває ISS-105): справжнє перейменування (нова назва
  // відрізняється від поточної) викликає інжектований recordRenameEvent з
  // (db, ownerUserId, cardId, нова назва) -- той самий шаблон, що
  // archive-card.ts's closeStructurePosition.
  it('calls recordRenameEvent with the new name when the name actually changes', async () => {
    const db = fakeDb({
      current: cardRow({ name: 'Здоровʼя' }),
      updated: cardRow({ name: 'Тіло і розум' }),
    });
    const recordRenameEvent = vi.fn().mockResolvedValue(undefined);

    await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, name: 'Тіло і розум' }, recordRenameEvent);

    expect(recordRenameEvent).toHaveBeenCalledTimes(1);
    expect(recordRenameEvent).toHaveBeenCalledWith(db, OWNER, CARD_ID, 'Тіло і розум');
  });

  // Той самий рядок, що вже збережений -- не перейменування, подія не пишеться.
  it('does not call recordRenameEvent when the passed name matches the current name', async () => {
    const db = fakeDb({
      current: cardRow({ name: 'Здоровʼя' }),
      updated: cardRow({ name: 'Здоровʼя' }),
    });
    const recordRenameEvent = vi.fn().mockResolvedValue(undefined);

    await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, name: 'Здоровʼя' }, recordRenameEvent);

    expect(recordRenameEvent).not.toHaveBeenCalled();
  });

  // markFilled-лише виклик (поле `name` взагалі не передане) -- не перейменування.
  it('does not call recordRenameEvent when `name` is not part of the call', async () => {
    const db = fakeDb({
      current: cardRow({ description: 'Хочу бути активнішим' }),
      updated: cardRow({ description: 'Хочу бути активнішим' }),
    });
    const recordRenameEvent = vi.fn().mockResolvedValue(undefined);

    await updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, markFilled: true }, recordRenameEvent);

    expect(recordRenameEvent).not.toHaveBeenCalled();
  });

  // Без переданого recordRenameEvent (composition root ще не підключив
  // структуру, чи тест) -- use-case просто не робить цей крок, не падає.
  it('does not fail when recordRenameEvent is not provided, even on a real rename', async () => {
    const db = fakeDb({
      current: cardRow({ name: 'Здоровʼя' }),
      updated: cardRow({ name: 'Тіло і розум' }),
    });

    await expect(
      updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, name: 'Тіло і розум' })
    ).resolves.toMatchObject({ name: 'Тіло і розум' });
  });

  // CH-02 (docs/features/life-area-card/changes.md): "картка: стан без
  // вимірювань" -- перемикання trackingMode/healthState.
  describe('CH-02 trackingMode', () => {
    it('rejects switching to state tracking without a valid healthState, before any UPDATE query', async () => {
      const db = fakeDb({ current: cardRow() });

      await expect(
        updateCard(db, { ownerUserId: OWNER, cardId: CARD_ID, trackingMode: 'state' })
      ).rejects.toThrow(CardValidationError);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid healthState value, before any UPDATE query', async () => {
      const db = fakeDb({ current: cardRow() });

      await expect(
        updateCard(db, {
          ownerUserId: OWNER,
          cardId: CARD_ID,
          trackingMode: 'state',
          healthState: 'archived' as never,
        })
      ).rejects.toThrow(CardValidationError);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('switches to state tracking with a valid healthState', async () => {
      const db = fakeDb({
        current: cardRow(),
        updated: cardRow({ tracking_mode: 'state', health_state: 'critical' }),
      });

      const result = await updateCard(db, {
        ownerUserId: OWNER,
        cardId: CARD_ID,
        trackingMode: 'state',
        healthState: 'critical',
      });

      expect(result.trackingMode).toBe('state');
      expect(result.healthState).toBe('critical');
    });

    it('switching to goals always clears healthState, even if one is passed', async () => {
      const db = fakeDb({
        current: cardRow({ tracking_mode: 'state', health_state: 'paused' }),
        updated: cardRow({ tracking_mode: 'goals', health_state: null }),
      });

      const result = await updateCard(db, {
        ownerUserId: OWNER,
        cardId: CARD_ID,
        trackingMode: 'goals',
        healthState: 'active',
      });

      expect(result.trackingMode).toBe('goals');
      expect(result.healthState).toBeNull();
    });

    // CH-10 (docs/features/life-area-card/changes.md): третій режим --
    // 'ongoing' -- той самий "завжди скидає healthState" гілка, окреме
    // значення (не варіант 'goals').
    it('switching to ongoing always clears healthState, even if one is passed', async () => {
      const db = fakeDb({
        current: cardRow({ tracking_mode: 'state', health_state: 'active' }),
        updated: cardRow({ tracking_mode: 'ongoing', health_state: null }),
      });

      const result = await updateCard(db, {
        ownerUserId: OWNER,
        cardId: CARD_ID,
        trackingMode: 'ongoing',
        healthState: 'critical',
      });

      expect(result.trackingMode).toBe('ongoing');
      expect(result.healthState).toBeNull();
    });
  });
});
