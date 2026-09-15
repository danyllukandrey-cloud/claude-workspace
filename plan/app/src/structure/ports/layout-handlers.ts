// T16 -- Ports: GET /structure/layout + GET /structure/layout/history handlers.
// contracts/openapi.yaml `/api/v1/structure/layout` (listLayoutPositions) і
// `/api/v1/structure/layout/history` (getLayoutHistoryAsOf), spec.md §5 AC-01/AC-07.
//
// Framework-agnostic (той самий підхід, що ../../cards/life-area-card/ports/
// card-handlers.ts, і ./structure-handlers.ts, T15) -- звичайна async-функція
// (db, ownerUserId, ...) -> DTO відповідної схеми контракту.
//
// AC-01: LayoutPositionPage -- items + has_next/has_prev/next_cursor, той
// самий пагінаційний контракт, що CardPage (card-handlers.ts's listCards) --
// сортуємо в пам'яті (positionUpdatedAt DESC, id як тай-брейк), курсор -- id
// позиції.
//
// AC-07: getLayoutHistoryAsOf реконструює розкладку "на момент часу" з
// structure_history_event -- validate-first (structure.invalid_as_of, 422)
// ДО будь-якого запиту в базу, той самий підхід, що structure-handlers.ts's
// updateStructure, і той самий "cell_index -> N" `detail`-формат, що
// ../app/get-analytics.ts вже парсить.

import { listActiveLayoutPositionsByOwner, findStructureByOwner } from '../infra/postgres-repo';
import type { Db, LayoutPositionRecord, LayoutPositionStatusRow } from '../infra/postgres-repo';
import { findHistoryEventsAsOf, type HistoryEventRecord } from '../infra/history-repo';
import { moveCard, type RecordAction } from '../app/move-card';
import { closeCard, type CloseCardMetricTransfer } from '../app/close-card';
import { AppError } from '../../shared/errors';

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.LayoutPosition ---

export interface LayoutPositionDto {
  cardId: string;
  cellIndex: number;
  status: LayoutPositionStatusRow;
  positionUpdatedAt: string;
}

export interface LayoutPositionPageDto {
  items: LayoutPositionDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toLayoutPositionDto(record: LayoutPositionRecord): LayoutPositionDto {
  return {
    cardId: record.cardId,
    cellIndex: record.cellIndex,
    status: record.status,
    positionUpdatedAt: record.positionUpdatedAt.toISOString(),
  };
}

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

/**
 * Сортуємо в пам'яті перед різанням на сторінки (той самий підхід, що
 * card-handlers.ts's sortCardsForPaging) -- positionUpdatedAt DESC, id як
 * тай-брейк для повної визначеності при однаковому часі.
 */
function sortPositionsForPaging(records: LayoutPositionRecord[]): LayoutPositionRecord[] {
  return [...records].sort((a, b) => {
    const byUpdatedAt = b.positionUpdatedAt.getTime() - a.positionUpdatedAt.getTime();
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function pagePositions(records: LayoutPositionRecord[], after: string | undefined, limit: number): LayoutPositionPageDto {
  let startIndex = 0;
  if (after) {
    const afterIndex = records.findIndex((record) => record.id === after);
    // Курсор не знайдено -- трактуємо як невалідний, читаємо з початку
    // списку (той самий лінієнтний підхід, що listCards).
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  const page = records.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < records.length;

  return {
    items: page.map(toLayoutPositionDto),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

// --- listLayoutPositions -- GET /api/v1/structure/layout -------------------

export interface ListLayoutPositionsQuery {
  /** uuid курсор попередньої сторінки (id останньої позиції). */
  after?: string;
  /** 1..100, default 50. */
  limit?: number;
}

export async function listLayoutPositions(
  db: Db,
  ownerUserId: string,
  query: ListLayoutPositionsQuery = {}
): Promise<LayoutPositionPageDto> {
  const records = sortPositionsForPaging(await listActiveLayoutPositionsByOwner(db, ownerUserId));
  return pagePositions(records, query.after, clampLimit(query.limit));
}

// --- getLayoutHistoryAsOf -- GET /api/v1/structure/layout/history ----------

/** Parses the only `detail` shape currently in use: "cell_index -> N" (../app/get-analytics.ts). */
function parsePastCellIndex(detail: string | null): number | null {
  if (!detail) return null;
  const match = detail.match(/cell_index\s*->\s*(-?\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * 422 structure.invalid_as_of -- відсутній, невалідний ISO 8601, або в
 * майбутньому, перевірено ДО будь-якого запиту в базу (AC-07's DoD).
 */
function parseValidPastAsOf(asOf: string | undefined): Date {
  if (!asOf) {
    throw new AppError('structure.invalid_as_of', 'asOf is required', 422);
  }
  const parsed = new Date(asOf);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('structure.invalid_as_of', 'asOf must be a valid ISO 8601 timestamp', 422);
  }
  if (parsed.getTime() > Date.now()) {
    throw new AppError('structure.invalid_as_of', 'asOf must be in the past', 422);
  }
  return parsed;
}

export async function getLayoutHistoryAsOf(
  db: Db,
  ownerUserId: string,
  asOf: string | undefined
): Promise<LayoutPositionPageDto> {
  const parsedAsOf = parseValidPastAsOf(asOf);

  const structure = await findStructureByOwner(db, ownerUserId);
  if (!structure) {
    return { items: [], has_next: false, has_prev: false, next_cursor: null };
  }

  const history = await findHistoryEventsAsOf(db, structure.id, parsedAsOf);

  // history ordered ascending by occurred_at (findHistoryEventsAsOf) --
  // later 'moved' entries overwrite earlier ones, leaving the LATEST
  // reconstructed cellIndex per card as of `asOf` (той самий підхід, що
  // ../app/get-analytics.ts's latestMovedByCard).
  const latestMovedByCard = new Map<string, HistoryEventRecord>();
  for (const event of history) {
    if (event.eventType === 'moved') {
      latestMovedByCard.set(event.cardId, event);
    }
  }

  const items: LayoutPositionDto[] = [];
  for (const [cardId, event] of latestMovedByCard) {
    const cellIndex = parsePastCellIndex(event.detail);
    if (cellIndex === null) continue;
    items.push({
      cardId,
      cellIndex,
      status: 'active',
      positionUpdatedAt: event.occurredAt.toISOString(),
    });
  }

  return { items, has_next: false, has_prev: false, next_cursor: null };
}

// --- moveCardPosition -- PUT /api/v1/structure/layout/{cardId} (T17) -------

export interface MoveCardPositionBody {
  cellIndex: number;
  positionUpdatedAt: string;
}

/**
 * Тонка обгортка над app/move-card.ts's `moveCard` (T12, вже done) --
 * порт лише мапить `LayoutPositionRecord` у той самий `LayoutPositionDto`,
 * що вже виробляє `listLayoutPositions`, і пропускає `AppError`
 * (structure.card_not_found 404, structure.cell_occupied 409) як є --
 * жодного іншого статусу порт не додає (DoD).
 */
export async function moveCardPosition(
  db: Db,
  ownerUserId: string,
  cardId: string,
  body: MoveCardPositionBody,
  recordAction?: RecordAction
): Promise<LayoutPositionDto> {
  const moved = await moveCard(
    db,
    {
      ownerUserId,
      cardId,
      cellIndex: body.cellIndex,
      positionUpdatedAt: body.positionUpdatedAt,
    },
    recordAction
  );
  return toLayoutPositionDto(moved);
}

// --- closeCardPosition -- POST /api/v1/structure/layout/{cardId}/close (T18) --

export interface CloseCardPositionBody {
  /** Опційно, за замовчуванням []; відсутнє тіло -- жодного переносу. */
  metricTransfers?: CloseCardMetricTransfer[];
}

/**
 * Тонка обгортка над app/close-card.ts's `closeCard` (T13, вже done) --
 * порт додатково перемаповує чужий 'card.not_found' (404), що
 * transferMetricBlock кидає на невалідну ціль переносу метрики, на
 * структурний 'structure.metric_transfer_target_invalid' (422) із контракту
 * -- closeCard сам цю помилку не мапить, бо не має права знати про чужі
 * коди (app -> cards, plan/app/CLAUDE.md, DoD цієї задачі). 'structure.
 * card_not_found' (404) від самого closeCard пропускається як є.
 */
export async function closeCardPosition(
  db: Db,
  ownerUserId: string,
  cardId: string,
  body: CloseCardPositionBody = {},
  recordAction?: RecordAction
): Promise<LayoutPositionDto> {
  const activePositions = await listActiveLayoutPositionsByOwner(db, ownerUserId);
  const current = activePositions.find((position) => position.cardId === cardId);
  if (!current) {
    throw new AppError('structure.card_not_found', 'Картку не знайдено в розкладці Структури', 404);
  }

  try {
    await closeCard(db, { ownerUserId, cardId, metricTransfers: body.metricTransfers ?? [] }, recordAction);
  } catch (error) {
    if (error instanceof AppError && error.code === 'card.not_found') {
      throw new AppError('structure.metric_transfer_target_invalid', error.message, 422);
    }
    throw error;
  }

  return {
    cardId: current.cardId,
    cellIndex: current.cellIndex,
    status: 'closed',
    positionUpdatedAt: new Date().toISOString(),
  };
}
