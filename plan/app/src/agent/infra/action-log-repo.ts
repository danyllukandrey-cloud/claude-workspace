// Infra: Postgres repo над action_log ("Лог дій", заміна UI "Звіти
// активності" -- Андрій: "Це має бути Лог. В нього тупо пишемо кожну дію --
// час, дія, все."). Окрема, проста, ДОДАТКОВА таблиця, не чіпає
// activity_report (agent-worker's періодичні звіти лишаються backend-only
// механізмом, D-70) -- staged-міграція 12_create_action_log (не 06, той
// самий "5 таблиць агента" файл ../infra/postgres-repo.ts себе явно
// документує, action_log туди навмисно НЕ додається -- окремий файл, той
// самий підхід, що agent-worker/infra/activity-report-repo.ts для
// activity_report).
//
// DI (ADR-0004/ADR-0005): той самий мінімальний контракт `Db`, що
// ../infra/postgres-repo.ts (query(text, params) -> {rows}) -- structурно
// сумісний з усіма іншими `Db` у проєкті, тож ../app/record-action.ts можна
// інжектувати в use-case-и інших фіч (life-area-card/structure) без
// порушення правила залежностей (той самий підхід, що
// CloseStructurePositionForCard/RecordCardRenameEvent).
//
// Non-disclosure: findActionLogByOwner скоупить читання за owner_user_id
// у самому SQL -- чужий рядок фізично відсутній у результаті.
//
// Append-only (без update/delete) -- той самий підхід, що agent_audit_event/
// developer_report: лог дій ніколи не редагується заднім числом.

import type { QueryResultRow } from 'pg';

/** Мінімальний контракт до бази -- той самий, що ../infra/postgres-repo.ts. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ActionLogRecord {
  id: string;
  ownerUserId: string;
  action: string;
  occurredAt: Date;
}

interface RawActionLogRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  action: string;
  occurred_at: Date;
}

function toActionLogRecord(row: RawActionLogRow): ActionLogRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    action: row.action,
    occurredAt: row.occurred_at,
  };
}

const ACTION_LOG_COLUMNS = 'id, owner_user_id, action, occurred_at';

export async function insertActionLogEntry(
  db: Db,
  input: { id: string; ownerUserId: string; action: string }
): Promise<ActionLogRecord> {
  const { rows } = await db.query<RawActionLogRow>(
    `INSERT INTO action_log (id, owner_user_id, action) VALUES ($1, $2, $3) RETURNING ${ACTION_LOG_COLUMNS}`,
    [input.id, input.ownerUserId, input.action]
  );
  return toActionLogRecord(rows[0]);
}

/** Найновіші перші -- той самий порядок, що listAuditEventsByUser (../infra/postgres-repo.ts). */
export async function findActionLogByOwner(db: Db, ownerUserId: string): Promise<ActionLogRecord[]> {
  const { rows } = await db.query<RawActionLogRow>(
    `SELECT ${ACTION_LOG_COLUMNS} FROM action_log WHERE owner_user_id = $1 ORDER BY occurred_at DESC`,
    [ownerUserId]
  );
  return rows.map(toActionLogRecord);
}
