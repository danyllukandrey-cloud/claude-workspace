// T11 -- App: updateStructure use-case, integration level (test-plan.md:
// AC-11/AC-11b -- "integration"; AC-10 is covered at unit level in
// ./update-structure.test.ts).
//
// Проти РЕАЛЬНОЇ Neon (server/db.ts createDb(), ADR-0006) -- та сама
// конвенція, що вже використовує migrations.integration.test.ts (структурні
// таблиці) і server/archive-transaction.integration.test.ts (composition-
// root рівень). Docker відсутній у цьому середовищі, DATABASE_URL_POOLED/.env
// теж (root .env недоступний тут) -- очікується NON-red (createDb() кине
// одразу в beforeAll, чи запит впаде на мережі), не GOOD red; unit-рівневий
// тест поруч лишається джерелом TDD-циклу локально.
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): "Кожен з варіантів
// конфігурації потрібно просто розташувати за логікою" -- зміна layoutMode
// БІЛЬШЕ НЕ скидає позиції в NULL (старий AC-11b reset-у-трей прибраний
// разом з domain/layout.ts's switchLayoutMode). Замість цього
// app/apply-layout-mode.ts рахує РЕАЛЬНИЙ авто-розклад
// (domain/layout.ts computeAutoLayout) і записує x/y для КОЖНОЇ активної
// картки власника в тій самій транзакції.
//
// DoD (tracker.md T11): PATCH updates declaration/layoutMode; changing
// layoutMode to a new value runs the auto-layout for every active card "in
// the same transaction" -- транзакційність як така (BEGIN/COMMIT навколо
// обох кроків) належить composition root (T15, ADR-0006 withTransaction) --
// цей тест перевіряє СПОСТЕРЕЖУВАНИЙ результат (обидва кроки видно в БД
// після виклику), не сам факт відкриття транзакції.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { updateStructure } from './update-structure';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('updateStructure (integration) -- AC-10/AC-11/AC-11b проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let structureId: string;

  beforeAll(async () => {
    db = createDb();

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t11-${ownerId}`,
      't11@example.test',
    ]);

    structureId = crypto.randomUUID();
    await db.query(
      "INSERT INTO structure (id, owner_user_id, layout_mode) VALUES ($1, $2, 'free')",
      [structureId, ownerId]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає structure/structure_layout_position
    await db.end();
  });

  it('updates declaration/layoutMode and runs the new mode\'s auto-layout for every active card when layoutMode changes', async () => {
    // Дві реально розкладені картки (life-area-card's `card` таблиця тут
    // навмисно НЕ використовується -- FK card_id вимагає реального рядка
    // `card`, тож ставимо позиції на живі картки owner-а, як і
    // migrations.integration.test.ts D-69/D-103 уже робить).
    const cardOneId = crypto.randomUUID();
    const cardTwoId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardOneId, ownerId, 'T11 card one']);
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardTwoId, ownerId, 'T11 card two']);

    const positionOneId = crypto.randomUUID();
    const positionTwoId = crypto.randomUUID();
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 5, 5)',
      [positionOneId, structureId, cardOneId]
    );
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 1, 1)',
      [positionTwoId, structureId, cardTwoId]
    );

    const result = await updateStructure(db, {
      ownerUserId: ownerId,
      declaration: "картина світу, навіщо, пріоритет",
      layoutMode: 'balance',
    });

    expect(result.declaration).toBe("картина світу, навіщо, пріоритет");
    expect(result.layoutMode).toBe('balance');

    const { rows: positionsAfter } = await db.query<{ id: string; position_x: number; position_y: number }>(
      'SELECT id, position_x, position_y FROM structure_layout_position WHERE structure_id = $1 ORDER BY id',
      [structureId]
    );
    // AC-11b: обидві активні позиції реально перераховані за формулою
    // "balance" (domain/layout.ts) -- жодна не лишилась на своїй старій
    // позиції (5/5 і 1/1 відповідно), і жодна не стала NULL (не "скинута в
    // трей", а реально розкладена).
    const byId = new Map(positionsAfter.map((row) => [row.id, { x: row.position_x, y: row.position_y }]));
    expect(byId.get(positionOneId)).not.toEqual({ x: 5, y: 5 });
    expect(byId.get(positionTwoId)).not.toEqual({ x: 1, y: 1 });
    expect(byId.get(positionOneId)?.x).not.toBeNull();
    expect(byId.get(positionTwoId)?.x).not.toBeNull();
  });

  // Плоска модель (вимоги 14/15): перемикання між колишніми підвидами
  // ('balance' <-> 'focus') тепер звичайна зміна layoutMode -- той самий
  // авто-розклад-механізм, без окремого AC-16b-шляху.
  it('re-runs the auto-layout again when switching between the former "за логікою" subvariants directly', async () => {
    const result = await updateStructure(db, { ownerUserId: ownerId, layoutMode: 'focus' });

    expect(result.layoutMode).toBe('focus');

    const { rows } = await db.query<{ position_x: number | null }>(
      'SELECT position_x FROM structure_layout_position WHERE structure_id = $1',
      [structureId]
    );
    // "focus" теж розставляє РЕАЛЬНІ координати для кожної активної картки --
    // жодна не лишається NULL.
    expect(rows.every((row) => row.position_x !== null)).toBe(true);
  });

  // Вимога 6 (чат): 'staging' -- єдиний режим, де авто-розклад НІЧОГО не
  // пише, картки лишаються де є.
  it('switching into "staging" leaves every position exactly where it was -- a true no-op', async () => {
    const { rows: before } = await db.query<{ id: string; position_x: number | null; position_y: number | null }>(
      'SELECT id, position_x, position_y FROM structure_layout_position WHERE structure_id = $1 ORDER BY id',
      [structureId]
    );

    const result = await updateStructure(db, { ownerUserId: ownerId, layoutMode: 'staging' });

    expect(result.layoutMode).toBe('staging');

    const { rows: after } = await db.query<{ id: string; position_x: number | null; position_y: number | null }>(
      'SELECT id, position_x, position_y FROM structure_layout_position WHERE structure_id = $1 ORDER BY id',
      [structureId]
    );
    expect(after).toEqual(before);
  });
});
