// Review 2026-09-12 (agent code review, ports-owns-SQL finding) -- Infra
// (agent-worker): repository over `activity_report`.
//
// `activity_report` is agent-worker-owned (§5 SAD, separate container) -- the
// same reasoning ../../agent/infra/postgres-repo.ts already documents for why
// it explicitly stops at 5 tables (proposal/rules/memory/chat/audit) and
// never touches this one. Before this file existed, ../../agent/ports/
// reports-handler.ts wrote its own raw SQL against `activity_report` inline
// (the same pattern ./resource-writer.ts uses for `sync_resource`, a table
// with no repo of its own) -- but ADR-0005 (layered domain/app/infra/ports)
// says ports doesn't own SQL. This file is the fix: the query moves here,
// reports-handler.ts imports and calls it, keeping only its own
// pagination/DTO-mapping logic on top (unchanged).
//
// `Db` -- own local minimal contract (query(text, params) -> {rows}), the
// same shape as ../../agent/infra/postgres-repo.ts and ./resource-writer.ts,
// deliberately re-declared rather than imported -- this module does not
// import from the sibling `agent` module (module boundary, agent-worker is a
// separate container per §5 SAD).
//
// Non-disclosure: `WHERE user_id = $1` in the SQL itself -- another user's
// report is physically absent from the result set, not filtered out after
// the fact (same approach postgres-repo.ts documents for its own 5 tables).
//
// Filterable by periodType (reports-handler.ts DoD) -- the filter, when
// given, becomes an additional `AND period_type = $N` in the SQL, not an
// in-memory post-filter; omitted, the condition is absent from the query
// entirely. `ORDER BY generated_at DESC, id DESC` -- same sort+tiebreak pair
// that idx_activity_report_user_time (data-model.md) supports ("a user's
// report listing"); the id tiebreak guarantees one deterministic order,
// which the port's own cursor pagination on top depends on.

import type { QueryResultRow } from 'pg';

/** Мінімальний контракт до бази, який потрібен цьому репозиторію. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

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
export async function findActivityReportsByUser(
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
