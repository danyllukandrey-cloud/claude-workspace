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
// DoD (tracker.md T11): PATCH updates declaration/layoutMode; changing
// layoutMode to a new value resets every active position to base order "in
// the same transaction" -- транзакційність як така (BEGIN/COMMIT навколо
// обох кроків) належить composition root (T15, ще не збудований, ADR-0006
// withTransaction) -- цей тест перевіряє СПОСТЕРЕЖУВАНИЙ результат (обидва
// кроки видно в БД після виклику), не сам факт відкриття транзакції -- та
// перевірка природно приєднається до майбутнього server/*.integration.test.ts
// для /structure (T15/T40-стиль), коли ports-шар реально відкриватиме
// withTransaction навколо use-case.
//
// Плоска модель (вимоги 14/15): logicVariant і його інваріант (AC-16/AC-16b)
// прибрані повністю -- layoutMode тепер одне поле з 5 значеннями
// ('balance'/'focus'/'cause_effect'/'free'/'staging').

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

  it('updates declaration/layoutMode and resets every active position to base order when layoutMode changes', async () => {
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
      'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 5)',
      [positionOneId, structureId, cardOneId]
    );
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 1)',
      [positionTwoId, structureId, cardTwoId]
    );

    const result = await updateStructure(db, {
      ownerUserId: ownerId,
      declaration: "картина світу, навіщо, пріоритет",
      layoutMode: 'balance',
    });

    expect(result.declaration).toBe("картина світу, навіщо, пріоритет");
    expect(result.layoutMode).toBe('balance');

    const { rows: positionsAfter } = await db.query<{ id: string; cell_index: number }>(
      'SELECT id, cell_index FROM structure_layout_position WHERE structure_id = $1 ORDER BY id',
      [structureId]
    );
    // AC-11b: обидві активні позиції реально змінились -- жодна не лишилась
    // на своїй старій клітинці (5 і 1 відповідно) після зміни layoutMode.
    const byId = new Map(positionsAfter.map((row) => [row.id, row.cell_index]));
    expect(byId.get(positionOneId)).not.toBe(5);
    expect(byId.get(positionTwoId)).not.toBe(1);
  });

  // Плоска модель (вимоги 14/15): перемикання між колишніми підвидами
  // ('balance' <-> 'focus') тепер звичайна зміна layoutMode -- той самий
  // reset-механізм, без окремого AC-16b-шляху.
  it('resets active positions again when switching between the former "за логікою" subvariants directly', async () => {
    const result = await updateStructure(db, { ownerUserId: ownerId, layoutMode: 'focus' });

    expect(result.layoutMode).toBe('focus');

    const { rows } = await db.query<{ cell_index: number | null }>(
      'SELECT cell_index FROM structure_layout_position WHERE structure_id = $1',
      [structureId]
    );
    expect(rows.every((row) => row.cell_index === null)).toBe(true);
  });
});
