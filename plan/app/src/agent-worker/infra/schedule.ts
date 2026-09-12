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
//      Review fix (2026-09-12): цей файл раніше сам писав SQL, що
//      з'єднував `entry`/`card` (знання чужої схеми поза
//      life-area-card) -- натомість, за прецедентом ../app/daily-sync.ts's
//      buildUserSnapshot (той самий cross-feature read, той самий
//      ADR-0002), тепер повторно використовує власні експортовані функції
//      life-area-card (listCardsByOwner, listEntriesByCard) і сам лише
//      фільтрує/формує ActivityRecord[]. `entry` не має власного user_id
//      (life-area-card/data-model.md) -- лише `card_id`, тож "чия ця
//      активність" видно через картки власника (listCardsByOwner уже сам
//      фільтрує `WHERE owner_user_id = $1`, life-area-card/infra/postgres-repo.ts).
//      Лише `status = 'confirmed'` рахується активністю -- `pending`/`rejected`
//      ще не усталені факти (та сама межа, що life-area-card's
//      listPendingEntriesByCard), і лише записи в межах
//      [periodStart, periodEnd] включно (порівняння за датою UTC, той
//      самий підхід, що вже дає ../app/generate-report.ts's
//      buildReportContent для форматування дати).
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
import { listCardsByOwner, listEntriesByCard } from '../../cards/life-area-card/infra/postgres-repo';

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

/** Дата запису у форматі YYYY-MM-DD (UTC) -- порівнюється лексикографічно з periodStart/periodEnd, той самий формат. */
function recordedDateUtc(recordedAt: Date): string {
  return recordedAt.toISOString().slice(0, 10);
}

function isWithinPeriod(recordedAt: Date, periodStart: string, periodEnd: string): boolean {
  const recordedDate = recordedDateUtc(recordedAt);
  return recordedDate >= periodStart && recordedDate <= periodEnd;
}

/**
 * Читає підтверджену активність користувача (усі його картки) за
 * [periodStart, periodEnd] включно -- cross-feature read, зовнішній до
 * agent-worker DAG, реалізований через life-area-card's власні
 * listCardsByOwner/listEntriesByCard (не через власний SQL проти чужих
 * таблиць -- див. коментар угорі файлу).
 */
export async function readLifeAreaCardActivity(
  db: Db,
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<ActivityRecord[]> {
  const cards = await listCardsByOwner(db, userId);
  const entriesByCard = await Promise.all(cards.map((card) => listEntriesByCard(db, card.id)));

  const activity: ActivityRecord[] = entriesByCard
    .flat()
    .filter((entry) => entry.status === 'confirmed' && isWithinPeriod(entry.recordedAt, periodStart, periodEnd))
    .map((entry) => ({
      id: entry.id,
      cardId: entry.cardId,
      amount: entry.amount,
      rawText: entry.rawText,
      recordedAt: entry.recordedAt,
    }));

  activity.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return activity;
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
