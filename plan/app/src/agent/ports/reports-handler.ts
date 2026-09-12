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
// Читання без окремого репозиторію: postgres-repo.ts (T13) явно документує
// себе як покриття лише 5 таблиць агента (proposal/rules/memory/chat/audit)
// -- `activity_report` туди навмисно не входить, її власник -- `agent-worker`
// (окремий контейнер §5 SAD), а write-сторона (T15, schedule + report
// persistence) ще не реалізована й не є залежністю цієї задачі (tasks.json
// T23 deps: ["T13"] лише). Тому SQL тут прямий, той самий inline-`Db`-патерн,
// що вже встановлений ../../agent-worker/infra/resource-writer.ts (T38) для
// таблиці без власного репозиторного файлу. `Db`-контракт (query(text,
// params) -> {rows}) той самий, що ../infra/postgres-repo.ts вже задає --
// перевикористовуємо його тип, не дублюємо інтерфейс.
//
// Non-disclosure: WHERE user_id = $1 у самому SQL -- чужий звіт фізично
// відсутній у результаті, не відфільтрований пост-фактум (той самий підхід,
// що postgres-repo.ts вже документує для своїх 5 таблиць).
//
// Filterable by periodType (DoD) -- переданий фільтр іде прямо в SQL
// (додатковий `AND period_type = $N`), не постфільтрується в пам'яті; коли
// periodType не задано, умова взагалі відсутня в запиті. `ORDER BY
// generated_at DESC, id DESC` -- ідентична пара сортування й тай-брейку, що
// idx_activity_report_user_time (data-model.md) підтримує ("перелік звітів
// користувача"); тай-брейк на id гарантує єдиний детермінований порядок,
// потрібний для стабільного cursor-пагінування нижче.
//
// Cursor pagination (DoD) -- той самий in-memory підхід над уже
// відсортованим масивом, що ../../structure/ports/layout-handlers.ts's
// pagePositions і ../../cards/life-area-card/ports/card-handlers.ts's
// listCards: `after` -- id останнього звіту попередньої сторінки, `limit`
// затиснутий у межі контракту [1,100], дефолт 50. Прострочений/вигаданий
// cursor не вважається помилкою -- падає на першу сторінку.

import type { QueryResultRow } from 'pg';
import type { Db } from '../infra/postgres-repo';

export type ReportPeriodTypeRow = 'weekly' | 'monthly' | 'quarterly';
export type ReportStatusRow = 'generated' | 'dead_letter';

export interface ReportRecord {
  id: string;
  periodType: ReportPeriodTypeRow;
  periodStart: Date;
  periodEnd: Date;
  content: string;
  status: ReportStatusRow;
  generatedAt: Date;
}

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

interface RawReportRow extends QueryResultRow {
  id: string;
  period_type: ReportPeriodTypeRow;
  period_start: Date;
  period_end: Date;
  content: string;
  status: ReportStatusRow;
  generated_at: Date;
}

function toReportRecord(row: RawReportRow): ReportRecord {
  return {
    id: row.id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    content: row.content,
    status: row.status,
    generatedAt: row.generated_at,
  };
}

/** Один звіт користувача, опційно звужений за periodType -- DoD "filterable by periodType". */
async function findActivityReportsByUser(
  db: Db,
  userId: string,
  periodType: ReportPeriodTypeRow | undefined
): Promise<ReportRecord[]> {
  const params: unknown[] = [userId];
  let periodTypeCondition = '';
  if (periodType) {
    params.push(periodType);
    periodTypeCondition = ` AND period_type = $${params.length}`;
  }

  const { rows } = await db.query<RawReportRow>(
    `SELECT id, period_type, period_start, period_end, content, status, generated_at
     FROM activity_report
     WHERE user_id = $1${periodTypeCondition}
     ORDER BY generated_at DESC, id DESC`,
    params
  );
  return rows.map(toReportRecord);
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
  /** 1..100, default 50. */
  limit?: number;
}

export async function listReports(db: Db, ownerUserId: string, query: ListReportsQuery = {}): Promise<ReportPageDto> {
  const records = sortReportsForPaging(await findActivityReportsByUser(db, ownerUserId, query.periodType));
  return pageReports(records, query.after, clampLimit(query.limit));
}
