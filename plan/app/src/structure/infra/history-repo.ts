// T10 -- Infra: history repository (write + asOf read).
// AC-07 (тренд розриву читає літопис на момент часу), AC-15 (перейменування/
// перенесення записуються як structure_history_event, той самий механізм, що
// й закриття картки AC-12). Same DI (`Db`) і стиль (RETURNING на write,
// camelCase-мапінг на межі), що й ./postgres-repo.ts.

import type { QueryResultRow } from 'pg';
import type { Db } from './postgres-repo';

export type HistoryEventType = 'renamed' | 'moved' | 'closed';

export interface HistoryEventRecord {
  id: string;
  structureId: string;
  cardId: string;
  eventType: HistoryEventType;
  detail: string | null;
  occurredAt: Date;
}

interface RawHistoryEventRow extends QueryResultRow {
  id: string;
  structure_id: string;
  card_id: string;
  event_type: HistoryEventType;
  detail: string | null;
  occurred_at: Date;
}

function toHistoryEventRecord(row: RawHistoryEventRow): HistoryEventRecord {
  return {
    id: row.id,
    structureId: row.structure_id,
    cardId: row.card_id,
    eventType: row.event_type,
    detail: row.detail,
    occurredAt: row.occurred_at,
  };
}

const HISTORY_EVENT_COLUMNS = 'id, structure_id, card_id, event_type, detail, occurred_at';

/**
 * Записує подію Літопису Структури (AC-15: rename/move, той самий механізм,
 * що й closed з AC-12). `occurred_at` -- default now() (data-model.md), тому
 * тут не передається.
 */
export async function insertHistoryEvent(
  db: Db,
  input: { id: string; structureId: string; cardId: string; eventType: HistoryEventType; detail?: string | null }
): Promise<HistoryEventRecord> {
  const { rows } = await db.query<RawHistoryEventRow>(
    `INSERT INTO structure_history_event (id, structure_id, card_id, event_type, detail)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${HISTORY_EVENT_COLUMNS}`,
    [input.id, input.structureId, input.cardId, input.eventType, input.detail ?? null]
  );
  return toHistoryEventRecord(rows[0]);
}

/**
 * Читає літопис Структури "на момент часу" asOf (AC-07: тренд розриву не
 * знімок, а реконструкція з логу подій). Порожній результат -- не помилка,
 * просто на цей момент подій ще не було.
 */
export async function findHistoryEventsAsOf(db: Db, structureId: string, asOf: Date): Promise<HistoryEventRecord[]> {
  const { rows } = await db.query<RawHistoryEventRow>(
    `SELECT ${HISTORY_EVENT_COLUMNS} FROM structure_history_event
     WHERE structure_id = $1 AND occurred_at <= $2
     ORDER BY occurred_at ASC`,
    [structureId, asOf]
  );
  return rows.map(toHistoryEventRecord);
}
