// T15 -- Infra (agent-worker): schedule + report persistence (AC-11,
// sad.md §6 Flow 14, ADR-0002).
//
// Дві прицільні операції, які цей файл надає App-шару (T19
// generate-report use-case), а той уже оркеструє їх разом із T11's
// computeReportPeriod/activityReportIdempotencyKey (../domain/report.ts)
// і додає retry/backoff/dead-letter (Flow 14, поза межами infra):
//
//   1. readLifeAreaCardActivity -- CROSS-FEATURE READ (agent-worker ->
//      cards/life-area-card), зовнішній до цього DAG (tasks.json T15 dod).
//      ADR-0002: worker ділить ту саму PostgreSQL, що backend-service, і
//      сам читає активність напряму з бази -- без черги/події. `entry` не
//      має власного user_id (life-area-card/data-model.md) -- лише
//      `card_id`, тож доступ до "чия ця активність" йде через
//      `card.owner_user_id` (той самий join-через-власника шаблон, що
//      ../../structure/infra/postgres-repo.ts уже використовує для
//      cross-feature перевірки власності). Лише `status = 'confirmed'`
//      рахується активністю -- `pending`/`rejected` ще не усталені факти
//      (та сама межа, що life-area-card's listPendingEntriesByCard).
//
//   2. saveActivityReport -- ІДЕМПОТЕНТНИЙ запис у `activity_report`
//      (data-model.md `uq_activity_report_period (user_id, period_type,
//      period_start)`). `INSERT ... ON CONFLICT (...) DO NOTHING` --
//      той самий SQL-рівень ідемпотентності, яким і керується унікальний
//      індекс: викликаний двічі з тим самим ключем ідемпотентності
//      (T11 activityReportIdempotencyKey) записує рівно один рядок
//      (tasks.json T15 dod) -- другий виклик мовчки повертає
//      `{ inserted: false }`, ніколи не кидає й не дублює.
//
// `Db` -- той самий контракт (query(text, params) -> {rows}), що й
// life-area-card/infra/postgres-repo.ts, structure/infra/postgres-repo.ts
// і ./resource-writer.ts. DI (ADR-0004): жодного власного з'єднання тут.

import type { QueryResultRow } from 'pg';
import type { ReportPeriodType } from '../domain/report';

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Один сирий запис активності (entry) -- достатньо App-шару, щоб зібрати текст звіту. */
export interface ActivityRecord {
  id: string;
  cardId: string;
  amount: number;
  rawText: string | null;
  recordedAt: Date;
}

interface RawActivityRow extends QueryResultRow {
  id: string;
  card_id: string;
  amount: string;
  raw_text: string | null;
  recorded_at: Date;
}

function toActivityRecord(row: RawActivityRow): ActivityRecord {
  return {
    id: row.id,
    cardId: row.card_id,
    amount: Number(row.amount),
    rawText: row.raw_text,
    recordedAt: row.recorded_at,
  };
}

/**
 * Читає підтверджену активність користувача (усі його картки) за
 * [periodStart, periodEnd] включно -- cross-feature read у `entry`/`card`
 * (life-area-card/data-model.md), зовнішній до agent-worker DAG.
 */
export async function readLifeAreaCardActivity(
  db: Db,
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<ActivityRecord[]> {
  const { rows } = await db.query<RawActivityRow>(
    `SELECT e.id, e.card_id, e.amount, e.raw_text, e.recorded_at
     FROM entry e
     JOIN card c ON c.id = e.card_id
     WHERE c.owner_user_id = $1
       AND e.status = 'confirmed'
       AND e.recorded_at::date BETWEEN $2 AND $3
     ORDER BY e.recorded_at ASC`,
    [userId, periodStart, periodEnd]
  );
  return rows.map(toActivityRecord);
}

/** Дані для одного запису activity_report -- id генерується викликачем (crypto.randomUUID(), §2 SAD). */
export interface ActivityReportInput {
  id: string;
  userId: string;
  periodType: ReportPeriodType;
  periodStart: string;
  periodEnd: string;
  content: string;
}

export interface ActivityReportSaveResult {
  /** false -- звіт за цей (user_id, period_type, period_start) уже існував, ONNOTHING нічого не вставив. */
  inserted: boolean;
}

/**
 * Ідемпотентно вставляє рядок `activity_report` (Flow 14, AC-11):
 * `ON CONFLICT (user_id, period_type, period_start) DO NOTHING` спирається
 * рівно на унікальний індекс `uq_activity_report_period`
 * (data-model.md) -- виклик двічі з тим самим ключем ідемпотентності
 * (T11 activityReportIdempotencyKey) залишає в таблиці лише один рядок,
 * другий виклик повертає `{ inserted: false }`, ніколи не кидає.
 * Retry/backoff і позначення `dead_letter` при провалі запису (Flow 14) --
 * відповідальність App-шару (T19), не цього примітиву.
 */
export async function saveActivityReport(db: Db, input: ActivityReportInput): Promise<ActivityReportSaveResult> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO activity_report (id, user_id, period_type, period_start, period_end, content)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, period_type, period_start) DO NOTHING
     RETURNING id`,
    [input.id, input.userId, input.periodType, input.periodStart, input.periodEnd, input.content]
  );
  return { inserted: rows.length > 0 };
}
