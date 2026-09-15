// T16 -- Ports: GET /structure/layout + GET /structure/layout/history handlers.
// RED (unit level, mocked Db -- test-plan.md маркує AC-01 і AC-07 як integration
// (справжній Postgres); Docker/Neon недоступні в цьому середовищі, тож
// повноцінний integration-рівень лишається NON-red тут -- цей файл робить
// задачу TDD-водимою локально без реальної БД, той самий підхід, що
// ../../cards/life-area-card/ports/card-handlers.test.ts (fake `Db.query`,
// маршрутизація за текстом SQL, use-case/domain-шар лишається справжнім) і
// ./structure-handlers.test.ts (T15, той самий модуль ports/).
//
// Contract (contracts/openapi.yaml):
// - GET /api/v1/structure/layout (listLayoutPositions): LayoutPositionPage
//   (items + has_next + has_prev + next_cursor), cursor `after` + `limit`
//   (1..100, default 50) -- той самий пагінаційний контракт, що
//   card-handlers.ts's listCards (T21), лише інший ресурс.
// - GET /api/v1/structure/layout/history (getLayoutHistoryAsOf): те саме
//   LayoutPositionPage, реконструйоване "на момент часу" з
//   structure_history_event (AC-07, той самий `parsePastCellIndex`-підхід,
//   що вже встановлений у ../app/get-analytics.ts). 422
//   structure.invalid_as_of -- asOf відсутній, невалідний ISO 8601, або в
//   майбутньому -- перевірено ДО будь-якого запиту в базу (той самий
//   validate-first підхід, що structure-handlers.ts's updateStructure).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// T18 -- closeCardPosition делегує метрик-трансфери life-area-card's
// transferMetricBlock (той самий модуль, що ../app/close-card.ts вже
// викликає) -- мокаємо його тут тим самим підходом, що
// ../app/close-card.test.ts, щоб контролювати саме 422-мапінг помилки
// (card.not_found -> structure.metric_transfer_target_invalid), а не
// реальну доменну логіку перенесення.
vi.mock('../../cards/life-area-card/app/transfer-metric-block', () => ({
  transferMetricBlock: vi.fn(),
}));

import { listLayoutPositions, getLayoutHistoryAsOf, moveCardPosition, closeCardPosition } from './layout-handlers';
import { transferMetricBlock } from '../../cards/life-area-card/app/transfer-metric-block';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function positionRow(
  overrides: Partial<{
    id: string;
    structure_id: string;
    card_id: string;
    position_x: number | null;
    position_y: number | null;
    status: 'active' | 'closed';
    position_updated_at: Date;
    created_at: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'position-1',
    structure_id: overrides.structure_id ?? STRUCTURE_ID,
    card_id: overrides.card_id ?? 'card-1',
    position_x: overrides.position_x ?? 0,
    position_y: overrides.position_y ?? 0,
    status: overrides.status ?? 'active',
    position_updated_at: overrides.position_updated_at ?? new Date('2026-01-01T00:00:00Z'),
    created_at: overrides.created_at ?? new Date('2026-01-01T00:00:00Z'),
  };
}

// --- listLayoutPositions -- GET /api/v1/structure/layout -------------------

function fakeListLayoutDb(rows: ReturnType<typeof positionRow>[]): Db {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('structure_layout_position')) {
      expect(params).toContain(OWNER);
      return { rows };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('listLayoutPositions handler', () => {
  // Happy path -- контракт LayoutPositionPage, форма кожного елемента точно
  // components.schemas.LayoutPosition (camelCase, positionUpdatedAt як ISO-рядок).
  it('returns every active position as a LayoutPositionPage matching the contract shape', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', position_x: 20, position_y: 30 }),
      positionRow({ id: 'position-2', card_id: 'card-2', position_x: 60, position_y: 70 }),
    ]);

    const page = await listLayoutPositions(db, OWNER, {});

    expect(page).toEqual({
      items: [
        { cardId: 'card-1', x: 20, y: 30, status: 'active', positionUpdatedAt: expect.any(String) },
        { cardId: 'card-2', x: 60, y: 70, status: 'active', positionUpdatedAt: expect.any(String) },
      ],
      has_next: false,
      has_prev: false,
      next_cursor: null,
    });
  });

  // Cursor pagination -- `limit` обмежує сторінку, `has_next`/`next_cursor`
  // сигналізують, що є ще, той самий контракт, що CardPage (card-handlers.ts).
  it('paginates with limit and reports has_next + next_cursor when more remain', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', position_x: 0, position_y: 0 }),
      positionRow({ id: 'position-2', card_id: 'card-2', position_x: 10, position_y: 10 }),
      positionRow({ id: 'position-3', card_id: 'card-3', position_x: 20, position_y: 20 }),
    ]);

    const page = await listLayoutPositions(db, OWNER, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].cardId).toBe('card-1');
    expect(page.has_next).toBe(true);
    expect(page.has_prev).toBe(false);
    expect(page.next_cursor).not.toBeNull();
  });

  // `after` продовжує з наступного елемента за курсором -- не з початку.
  it('resumes after the given cursor instead of restarting from the top', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', position_x: 0, position_y: 0 }),
      positionRow({ id: 'position-2', card_id: 'card-2', position_x: 10, position_y: 10 }),
      positionRow({ id: 'position-3', card_id: 'card-3', position_x: 20, position_y: 20 }),
    ]);

    const firstPage = await listLayoutPositions(db, OWNER, { limit: 1 });
    const secondPage = await listLayoutPositions(db, OWNER, { after: firstPage.next_cursor!, limit: 1 });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].cardId).toBe('card-2');
    expect(secondPage.has_prev).toBe(true);
  });
});

// --- getLayoutHistoryAsOf -- GET /api/v1/structure/layout/history ----------

function fakeHistoryDb(opts: {
  structure?: ReturnType<typeof positionRow> extends never ? never : { id: string; owner_user_id: string } | null;
  historyRows?: unknown[];
}): Db {
  const query = vi.fn(async (text: string) => {
    if (text.trim().toUpperCase().startsWith('SELECT') && text.includes('FROM structure') && !text.includes('structure_history_event') && !text.includes('structure_layout_position')) {
      return { rows: opts.structure === null || opts.structure === undefined ? [] : [opts.structure] };
    }
    if (text.includes('structure_history_event')) {
      return { rows: opts.historyRows ?? [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('getLayoutHistoryAsOf handler', () => {
  // 422 structure.invalid_as_of -- майбутня мітка часу, перевірено ДО
  // будь-якого запиту в базу (AC-07's DoD: "validates asOf is a past timestamp").
  it('rejects a future asOf with 422 structure.invalid_as_of before any query', async () => {
    const db = fakeHistoryDb({ historyRows: [] });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const error = await getLayoutHistoryAsOf(db, OWNER, future).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_as_of', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // 422 structure.invalid_as_of -- невалідний ISO 8601, той самий код і
  // статус, той самий validate-first порядок.
  it('rejects a malformed asOf with 422 structure.invalid_as_of before any query', async () => {
    const db = fakeHistoryDb({ historyRows: [] });

    const error = await getLayoutHistoryAsOf(db, OWNER, 'not-a-timestamp').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_as_of', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // Happy path (AC-07) -- реконструює розкладку на минулий момент з Літопису,
  // той самий "pos_x -> N, pos_y -> M" формат `detail`, що ../app/move-card.ts's
  // formatMovedDetail пише.
  it('reconstructs positions from the history log as of a valid past timestamp', async () => {
    const past = '2026-01-15T00:00:00Z';
    const db = fakeHistoryDb({
      structure: { id: STRUCTURE_ID, owner_user_id: OWNER },
      historyRows: [
        {
          id: 'event-1',
          structure_id: STRUCTURE_ID,
          card_id: 'card-1',
          event_type: 'moved',
          detail: 'pos_x -> 55, pos_y -> 40, prev_x -> none, prev_y -> none',
          occurred_at: new Date('2026-01-10T00:00:00Z'),
        },
      ],
    });

    const page = await getLayoutHistoryAsOf(db, OWNER, past);

    expect(page.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ cardId: 'card-1', x: 55, y: 40 })])
    );
  });
});

// --- moveCardPosition -- PUT /api/v1/structure/layout/{cardId} (T17) -------
//
// RED (unit level, mocked Db -- test-plan.md маркує AC-02/AC-08 як integration,
// AC-03 non-disclosure перевіряється тут проти того самого 404, що use-case
// (app/move-card.ts, T12, вже done) кидає сам; Docker/Neon недоступні в цьому
// середовищі, тож повноцінний integration-рівень лишається NON-red -- цей файл
// робить задачу TDD-водимою локально без реальної БД, той самий fake-Db стиль,
// що ./move-card.test.ts і решта цього файлу (listLayoutPositions/
// getLayoutHistoryAsOf).
//
// Контракт (contracts/openapi.yaml, moveCard):
// - 200 LayoutPosition -- happy path, порт лише мапить record use-case у DTO
//   (той самий toLayoutPositionDto, що вже використовує listLayoutPositions).
// - 404 structure.card_not_found -- та сама помилка й для неіснуючої, й для
//   чужої картки (AC-03 non-disclosure) -- use-case кидає сам, порт пропускає
//   як є, нічого не приховує й не додає.
// D-131-наступне рішення: AC-02 (колізія клітинки, 409 structure.cell_occupied)
// прибрана повністю -- вільне позиціювання не має колізії, лише клемп 0..100
// (move-card.test.ts вже це покриває на рівні use-case).
// DoD: "Handler returns 200/404 exactly per contract" -- жодного іншого
// статусу порт не додає зверху.

function fakeMoveDb(opts: {
  activePositions: Array<{
    id: string;
    structure_id: string;
    card_id: string;
    position_x: number | null;
    position_y: number | null;
    status: 'active' | 'closed';
    position_updated_at: Date;
    created_at: Date;
  }>;
  moved?: (typeof opts.activePositions)[number] | null;
}): Db {
  const query = vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('structure_history_event') && sql.startsWith('INSERT')) {
      return {
        rows: [
          {
            id: 'history-1',
            structure_id: STRUCTURE_ID,
            card_id: 'card-a',
            event_type: 'moved',
            detail: null,
            occurred_at: new Date('2026-01-03T00:00:00Z'),
          },
        ],
      };
    }
    if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
      return { rows: opts.activePositions };
    }
    if (text.includes('structure_layout_position') && sql.startsWith('UPDATE')) {
      return { rows: opts.moved ? [opts.moved] : [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('moveCardPosition handler', () => {
  // Happy path (AC-08) -- порт повертає LayoutPosition DTO точно у формі
  // контракту (camelCase, positionUpdatedAt як ISO-рядок), не сирий record
  // use-case-шару.
  it('returns 200 LayoutPosition DTO matching the contract shape', async () => {
    const current = positionRow({ card_id: 'card-a', position_x: 20, position_y: 30, position_updated_at: new Date('2026-01-02T00:00:00Z') });
    const moved = positionRow({ card_id: 'card-a', position_x: 65, position_y: 80, position_updated_at: new Date('2026-01-05T00:00:00Z') });
    const db = fakeMoveDb({ activePositions: [current], moved });

    const dto = await moveCardPosition(db, OWNER, 'card-a', {
      x: 65,
      y: 80,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    expect(dto).toEqual({
      cardId: 'card-a',
      x: 65,
      y: 80,
      status: 'active',
      positionUpdatedAt: expect.any(String),
    });
  });

  // Дві картки на дуже близьких (навіть однакових) координатах -- НЕ помилка
  // (D-131-наступне рішення прибрало AC-02 повністю, вимога 3 в чаті:
  // "пересуватись вільно").
  it('allows overlapping x/y with another active card -- no collision left to reject', async () => {
    const mover = positionRow({ card_id: 'card-a', position_x: 20, position_y: 30, position_updated_at: new Date('2026-01-02T00:00:00Z') });
    const occupant = positionRow({ card_id: 'card-b', position_x: 65, position_y: 80, position_updated_at: new Date('2026-01-02T00:00:00Z') });
    const moved = positionRow({ card_id: 'card-a', position_x: 65, position_y: 80, position_updated_at: new Date('2026-01-05T00:00:00Z') });
    const db = fakeMoveDb({ activePositions: [mover, occupant], moved });

    await expect(
      moveCardPosition(db, OWNER, 'card-a', { x: 65, y: 80, positionUpdatedAt: '2026-01-05T00:00:00Z' })
    ).resolves.toMatchObject({ x: 65, y: 80 });
  });

  // AC-03 (non-disclosure) -- картка без активної позиції власника (не
  // існує чи належить іншому користувачу) -- 404 structure.card_not_found,
  // той самий код для обох випадків, ніколи не підтверджуємо/спростовуємо.
  it('rejects with 404 structure.card_not_found for a missing or not-owned card, never confirming which', async () => {
    const db = fakeMoveDb({ activePositions: [] });

    const error = await moveCardPosition(db, OWNER, 'someone-elses-card', {
      x: 10,
      y: 10,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.card_not_found', httpStatus: 404 });
  });
});

// --- closeCardPosition -- POST /api/v1/structure/layout/{cardId}/close (T18) --
//
// RED (unit level, mocked Db + mocked life-area-card's transferMetricBlock --
// test-plan.md marks AC-12 as integration; Docker/Neon недоступні в цьому
// середовищі, тож повноцінний integration-рівень лишається NON-red -- цей
// файл робить задачу TDD-водимою локально без реальної БД, той самий
// fake-Db + vi.mock стиль, що ../app/close-card.test.ts і решта цього файлу
// (moveCardPosition вище).
//
// Контракт (contracts/openapi.yaml, closeCard, POST /structure/layout/{cardId}):
// - 200 LayoutPosition -- закрита позиція (status: 'closed'), той самий DTO
//   shape, що listLayoutPositions/moveCardPosition вище.
// - 404 structure.card_not_found -- та сама non-disclosure помилка (AC-03),
//   що moveCardPosition -- ../app/close-card.ts (T13, вже done) кидає сама,
//   handler пропускає як є.
// - 422 structure.metric_transfer_target_invalid -- цільова картка
//   перенесення метрики не знайдена чи не належить користувачу.
//   ../app/close-card.ts делегує ЦІЛКОМ life-area-card's transferMetricBlock,
//   яка на цю саму причину кидає СВІЙ код 'card.not_found' (404, чужий
//   формат, не про Структуру) -- handler цього файлу МАЄ перемапити його
//   саме на структурний код/статус із контракту, а не пропустити чужу
//   помилку як є (DoD: "returns 200/404/422 per contract").
// - metricTransfers -- опційний, за замовчуванням [] (DoD): відсутнє тіло
//   (undefined) не викликає transferMetricBlock жодного разу, закриття все
//   одно відбувається.

function fakeCloseDb(opts: { activePositions: ReturnType<typeof positionRow>[] }): Db {
  const query = vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();
    if (text.includes('structure_history_event') && sql.startsWith('INSERT')) {
      return {
        rows: [
          {
            id: 'history-1',
            structure_id: STRUCTURE_ID,
            card_id: 'card-a',
            event_type: 'closed',
            detail: null,
            occurred_at: new Date('2026-01-03T00:00:00Z'),
          },
        ],
      };
    }
    if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
      return { rows: opts.activePositions };
    }
    if (text.includes('structure_layout_position') && sql.startsWith('UPDATE')) {
      return { rows: [] };
    }
    if (text.includes('structure_connection') && sql.startsWith('DELETE')) {
      return { rows: [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('closeCardPosition handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Happy path (AC-12/AC-15) -- порт повертає LayoutPosition DTO з
  // status: 'closed', той самий контракт, що moveCardPosition/
  // listLayoutPositions вище (camelCase, positionUpdatedAt як ISO-рядок).
  it('closes the position and returns 200 LayoutPosition DTO with status "closed"', async () => {
    const current = positionRow({ card_id: 'card-a', position_x: 30, position_y: 40 });
    const db = fakeCloseDb({ activePositions: [current] });

    const dto = await closeCardPosition(db, OWNER, 'card-a');

    expect(dto).toEqual({
      cardId: 'card-a',
      x: 30,
      y: 40,
      status: 'closed',
      positionUpdatedAt: expect.any(String),
    });
  });

  // metricTransfers опційний, за замовчуванням [] (DoD) -- без переданого
  // тіла transferMetricBlock жодного разу не викликається, закриття все
  // одно відбувається.
  it('defaults metricTransfers to empty and never calls transferMetricBlock when the body is omitted', async () => {
    const current = positionRow({ card_id: 'card-a', position_x: 30, position_y: 40 });
    const db = fakeCloseDb({ activePositions: [current] });

    const dto = await closeCardPosition(db, OWNER, 'card-a');

    expect(transferMetricBlock).not.toHaveBeenCalled();
    expect(dto.status).toBe('closed');
  });

  // AC-03 (non-disclosure) -- картка без активної позиції власника (не
  // існує чи належить іншому користувачу) -- 404 structure.card_not_found,
  // той самий код, що moveCardPosition кидає для того самого класу помилки.
  it('rejects with 404 structure.card_not_found for a missing or not-owned card, never confirming which', async () => {
    const db = fakeCloseDb({ activePositions: [] });

    const error = await closeCardPosition(db, OWNER, 'someone-elses-card').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.card_not_found', httpStatus: 404 });
  });

  // 422 structure.metric_transfer_target_invalid -- transferMetricBlock
  // кидає СВІЙ 'card.not_found' (404) на невалідну цільову картку -- handler
  // ЦЬОГО файлу перемаповує на структурний код/статус із контракту, не
  // пропускає чужу помилку як є.
  it('maps an invalid metric-transfer target to 422 structure.metric_transfer_target_invalid, not the raw card.not_found', async () => {
    const current = positionRow({ card_id: 'card-a', position_x: 30, position_y: 40 });
    const db = fakeCloseDb({ activePositions: [current] });
    (transferMetricBlock as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404)
    );

    const error = await closeCardPosition(db, OWNER, 'card-a', {
      metricTransfers: [{ metricBlockId: 'mb-1', targetCardId: 'not-mine' }],
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.metric_transfer_target_invalid', httpStatus: 422 });
  });
});
