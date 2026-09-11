// T13 -- App: closeCard use-case.
// RED (unit level, mocked Db + mocked life-area-card's transferMetricBlock --
// test-plan.md marks AC-12 as "integration"; Docker/Neon недоступні в цьому
// середовищі, тож close-card.integration.test.ts лишиться NON-red -- цей
// файл робить задачу TDD-водимою локально без реальної БД, той самий стиль,
// що ../update-structure.test.ts (fake `Db.query`, маршрутизація за текстом
// SQL, postgres-repo.ts/history-repo.ts не мокаються самі, лише межа
// `db.query`).
//
// Contract (contracts/openapi.yaml, closeCard -- POST /structure/layout/{cardId}):
// - AC-12: закриває активну позицію картки (status: 'active' -> 'closed', той
//   самий м'який-статус механізм, що domain/layout.ts closeLayoutPosition,
//   D-66 -- ніколи фізичне видалення) і пише подію 'closed' у
//   structure_history_event (AC-15 -- той самий механізм, що rename/move,
//   T10 insertHistoryEvent).
// - Опційні `metricTransfers` делегуються ЦІЛКОМ life-area-card's
//   transferMetricBlock (DoD T13, life-area-card US-13/AC-14/AC-15) -- app ->
//   cards (plan/app/CLAUDE.md) -- Структура сама НІКОЛИ не пише в
//   metric_block/entry, лише викликає чужий use-case. "without touching
//   Structure's own tables" (DoD) перевіряється тут негативно: жодного
//   додаткового запиту над structure/structure_layout_position/
//   structure_history_event понад ті, що й так належать самому закриттю.
// - Відхилені (не перелічені в metricTransfers) метрики лишаються на
//   закритій картці -- жодного автоматичного переносу без явного запиту
//   користувача (AC-12).
// - AC-03 non-disclosure: cardId без активної позиції в Структурі власника
//   (чужа картка чи вигадка) -- 'structure.card_not_found', 404, ДО будь-
//   якого запису (як moveCard/updateStructure вже роблять для того самого
//   класу помилки).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

vi.mock('../../cards/life-area-card/app/transfer-metric-block', () => ({
  transferMetricBlock: vi.fn(),
}));

import { transferMetricBlock } from '../../cards/life-area-card/app/transfer-metric-block';
import { closeCard } from './close-card';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';
const CARD_ID = 'card-1';

function structureRow() {
  return {
    id: STRUCTURE_ID,
    owner_user_id: OWNER,
    declaration: null,
    layout_mode: 'free' as const,
    logic_variant: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
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

function historyEventRow() {
  return {
    id: 'event-1',
    structure_id: STRUCTURE_ID,
    card_id: CARD_ID,
    event_type: 'closed' as const,
    detail: null,
    occurred_at: new Date('2026-01-03T00:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує запит за текстом SQL до потрібного
 * канонічного рядка, той самий підхід, що вже ../update-structure.test.ts і
 * ../infra/postgres-repo.test.ts застосовують для цього самого модуля.
 */
function fakeDb(opts: {
  structure?: ReturnType<typeof structureRow> | null;
  activePositions?: ReturnType<typeof positionRow>[];
}): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    const upper = text.trim().toUpperCase();
    if (text.includes('structure_history_event')) {
      return { rows: [historyEventRow()] };
    }
    if (text.includes('structure_layout_position') && upper.startsWith('UPDATE')) {
      return { rows: [] };
    }
    if (text.includes('structure_layout_position') && upper.startsWith('SELECT')) {
      return { rows: opts.activePositions ?? [] };
    }
    if (upper.startsWith('SELECT') && text.includes('FROM structure WHERE')) {
      return { rows: opts.structure ? [opts.structure] : [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

function queryCalls(db: Db) {
  return (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
}

/** Запити, що закривають активну позицію (UPDATE ... structure_layout_position). */
function closeCalls(db: Db) {
  return queryCalls(db).filter(
    ([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE')
  );
}

/** Запити, що пишуть у Літопис Структури. */
function historyCalls(db: Db) {
  return queryCalls(db).filter(([text]) => text.includes('structure_history_event'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('closeCard -- AC-12/AC-15: закриття напрямку', () => {
  it('closes the active position and records a "closed" history event', async () => {
    const db = fakeDb({ structure: structureRow(), activePositions: [positionRow(CARD_ID, 3)] });

    await closeCard(db, { ownerUserId: OWNER, cardId: CARD_ID });

    const closes = closeCalls(db);
    expect(closes).toHaveLength(1);
    expect(closes[0][1]).toContain(CARD_ID);

    const historyWrites = historyCalls(db);
    expect(historyWrites).toHaveLength(1);
    expect(historyWrites[0][1]).toContain(CARD_ID);
    expect(historyWrites[0][1]).toContain('closed');
  });

  it('does not call transferMetricBlock when metricTransfers is omitted -- declined metrics stay behind', async () => {
    const db = fakeDb({ structure: structureRow(), activePositions: [positionRow(CARD_ID, 3)] });

    await closeCard(db, { ownerUserId: OWNER, cardId: CARD_ID });

    expect(transferMetricBlock).not.toHaveBeenCalled();
    // Закриття все одно відбулося -- відсутність перенесення не блокує закриття.
    expect(closeCalls(db)).toHaveLength(1);
  });

  it('delegates each requested metric transfer to life-area-card\'s transferMetricBlock, without Structure writing to metric_block/entry itself', async () => {
    const db = fakeDb({ structure: structureRow(), activePositions: [positionRow(CARD_ID, 3)] });
    (transferMetricBlock as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'metric-block-1' });

    await closeCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      metricTransfers: [{ metricBlockId: 'mb-1', targetCardId: 'card-2', newLabel: 'км (перенесено)' }],
    });

    expect(transferMetricBlock).toHaveBeenCalledWith(db, {
      ownerUserId: OWNER,
      targetCardId: 'card-2',
      metricBlockId: 'mb-1',
      newLabel: 'км (перенесено)',
    });

    // "без торкання власних таблиць Структури" (DoD) -- увесь трансфер пішов
    // через мокнутий transferMetricBlock, жоден db.query цього тесту не
    // згадує metric_block/entry -- лише те саме закриття+літопис, що й у
    // тесті без перенесення.
    for (const [text] of queryCalls(db)) {
      expect(text).not.toMatch(/metric_block|entry/i);
    }
  });

  it('returns "structure.card_not_found" when the card has no active position in the caller\'s Structure -- no write happens (AC-03 non-disclosure)', async () => {
    const db = fakeDb({ structure: structureRow(), activePositions: [] });

    await expect(closeCard(db, { ownerUserId: OWNER, cardId: CARD_ID })).rejects.toMatchObject({
      code: 'structure.card_not_found',
      httpStatus: 404,
    });
    await expect(closeCard(db, { ownerUserId: OWNER, cardId: CARD_ID })).rejects.toBeInstanceOf(AppError);

    expect(closeCalls(db)).toHaveLength(0);
    expect(historyCalls(db)).toHaveLength(0);
    expect(transferMetricBlock).not.toHaveBeenCalled();
  });
});
