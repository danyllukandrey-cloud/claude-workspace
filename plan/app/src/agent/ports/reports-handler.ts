// T23 -- Ports: GET /reports handler (AC-11, US-08).
// contracts/openapi.yaml `/api/v1/reports` (operationId listReports).
//
// Framework-agnostic (ADR-0004/ADR-0005, той самий підхід, що
// ../../structure/ports/structure-handlers.ts і
// ../../cards/life-area-card/ports/card-handlers.ts) -- звичайна
// async-функція (db, ownerUserId, query) -> DTO відповідної схеми контракту
// (ReportPage). Майбутній транспортний шар (T30) відповідає за
// .code/.message/.httpStatus; 401 у контракті -- турбота авторизаційного
// мідлвара (D-33), не цього файлу.
//
// Review 2026-09-12 (ADR-0005, "ports не володіє SQL"): читання
// `activity_report` (запит + мапінг рядка) винесено в
// ../../agent-worker/infra/activity-report-repo.ts -- `activity_report`
// належить agent-worker (окремий контейнер §5 SAD), не цьому модулю
// (postgres-repo.ts (T13) явно документує себе як покриття лише 5 таблиць
// агента, `activity_report` туди навмисно не входить). Цей файл лишає собі
// тільки пагінацію й DTO-мапінг поверх записів, що повертає репозиторій.
//
// Cursor pagination (DoD) -- той самий in-memory підхід над уже
// відсортованим масивом, що ../../structure/ports/layout-handlers.ts's
// pagePositions і ../../cards/life-area-card/ports/card-handlers.ts's
// listCards: `after` -- id останнього звіту попередньої сторінки, `limit`
// затиснутий у межі контракту [1,100], дефолт 20 (openapi.yaml GET /reports
// `limit.default`). Прострочений/вигаданий cursor не вважається помилкою --
// падає на першу сторінку.

import type { Db } from '../infra/postgres-repo';
import type { ReportPeriodTypeRow, ReportRecord, ReportStatusRow } from '../../agent-worker/infra/activity-report-repo';
import { findActivityReportsByUser } from '../../agent-worker/infra/activity-report-repo';

export type { ReportPeriodTypeRow, ReportStatusRow };

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.Report --

export interface ReportDto {
  id: string;
  periodType: ReportPeriodTypeRow;
  /** date (не date-time) -- контракт: components.schemas.Report.periodStart. */
  periodStart: string;
  periodEnd: string;
  content: string;
  status: ReportStatusRow;
  generatedAt: string;
}

export interface ReportPageDto {
  items: ReportDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

/** DATE-колонка (period_start/period_end) -> "YYYY-MM-DD", завжди з UTC-складової toISOString -- не залежить від локального часового поясу процесу. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toReportDto(record: ReportRecord): ReportDto {
  return {
    id: record.id,
    periodType: record.periodType,
    periodStart: toDateOnly(record.periodStart),
    periodEnd: toDateOnly(record.periodEnd),
    content: record.content,
    status: record.status,
    generatedAt: record.generatedAt.toISOString(),
  };
}

const DEFAULT_LIMIT = 20;
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
 * ../../structure/ports/layout-handlers.ts's sortPositionsForPaging і
 * ../../cards/life-area-card/ports/card-handlers.ts's sortCardsForPaging:
 * `ORDER BY` у власному SQL вище вже дає цей порядок від справжньої
 * Postgres, але порт не покладається лише на це -- сортування тут робить
 * cursor-пагінування детермінованим незалежно від того, що саме повернув
 * `Db.query` (мокований у тестах). generatedAt DESC, id як тай-брейк для
 * повної визначеності при однаковому часі.
 */
function sortReportsForPaging(records: ReportRecord[]): ReportRecord[] {
  return [...records].sort((a, b) => {
    const byGeneratedAt = b.generatedAt.getTime() - a.generatedAt.getTime();
    if (byGeneratedAt !== 0) {
      return byGeneratedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function pageReports(records: ReportRecord[], after: string | undefined, limit: number): ReportPageDto {
  let startIndex = 0;
  if (after) {
    const afterIndex = records.findIndex((record) => record.id === after);
    // Прострочений/невалідний cursor -- падаємо на першу сторінку, не помилка.
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  const page = records.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < records.length;

  return {
    items: page.map(toReportDto),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

// --- listReports -- GET /api/v1/reports ------------------------------------

export interface ListReportsQuery {
  periodType?: ReportPeriodTypeRow;
  /** uuid курсор попередньої сторінки (id останнього звіту). */
  after?: string;
  /** 1..100, default 20. */
  limit?: number;
}

export async function listReports(db: Db, ownerUserId: string, query: ListReportsQuery = {}): Promise<ReportPageDto> {
  const records = sortReportsForPaging(await findActivityReportsByUser(db, ownerUserId, query.periodType));
  return pageReports(records, query.after, clampLimit(query.limit));
}
