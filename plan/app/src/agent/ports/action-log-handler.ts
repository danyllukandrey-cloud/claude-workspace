// Ports: GET /action-log handler -- "Лог дій" (заміна UI "Звіти активності",
// Андрій: "тупо пишемо кожну дію -- час, дія, все."). Той самий
// framework-agnostic підхід і той самий cursor-пагінаційний шаблон, що
// ../ports/reports-handler.ts's listReports/../../structure/ports/
// layout-handlers.ts's listLayoutPositions -- звичайна async-функція
// (db, ownerUserId, query) -> DTO, найновіші перші.
//
// Без categoryType/фільтрів (свідоме обмеження обсягу, узгоджено з Андрієм)
// -- лише after/limit, на відміну від reports-handler.ts's periodType.

import type { Db } from '../infra/action-log-repo';
import { findActionLogByOwner } from '../infra/action-log-repo';
import type { ActionLogRecord } from '../infra/action-log-repo';

// --- DTO -- camelCase, найновіші перші -------------------------------------

export interface ActionLogEntryDto {
  id: string;
  action: string;
  occurredAt: string;
}

export interface ActionLogPageDto {
  items: ActionLogEntryDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toActionLogEntryDto(record: ActionLogRecord): ActionLogEntryDto {
  return {
    id: record.id,
    action: record.action,
    occurredAt: record.occurredAt.toISOString(),
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
 * Сортуємо в пам'яті перед різанням на сторінки -- той самий підхід, що
 * ../ports/reports-handler.ts's sortReportsForPaging: репозиторій уже дає
 * ORDER BY occurred_at DESC, але пагінація тут не покладається лише на це.
 */
function sortForPaging(records: ActionLogRecord[]): ActionLogRecord[] {
  return [...records].sort((a, b) => {
    const byOccurredAt = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (byOccurredAt !== 0) {
      return byOccurredAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function pageActionLog(records: ActionLogRecord[], after: string | undefined, limit: number): ActionLogPageDto {
  let startIndex = 0;
  if (after) {
    const afterIndex = records.findIndex((record) => record.id === after);
    // Прострочений/вигаданий cursor -- падаємо на першу сторінку, не помилка
    // (той самий підхід, що решта пагінованих ендпоінтів проєкту).
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  const page = records.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < records.length;

  return {
    items: page.map(toActionLogEntryDto),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

export interface ListActionLogQuery {
  /** uuid курсор попередньої сторінки (id останнього запису). */
  after?: string;
  /** 1..100, default 50. */
  limit?: number;
}

/** GET /api/v1/action-log -- хронологічний список дій власника, найновіші перші. */
export async function listActionLog(db: Db, ownerUserId: string, query: ListActionLogQuery = {}): Promise<ActionLogPageDto> {
  const records = sortForPaging(await findActionLogByOwner(db, ownerUserId));
  return pageActionLog(records, query.after, clampLimit(query.limit));
}
