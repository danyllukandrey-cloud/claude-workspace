// T40 -- App: sync-resource CRUD use-cases (US-12, AC-18).
//
// `sync_resource` (data-model.md) -- список зовнішніх ресурсів (Google
// Doc/Sheet тощо), куди `agent-worker`'s daily-sync (T41) щодня пише копію
// даних користувача (AC-18). Ці три use-case лише керують САМИМ СПИСКОМ
// посилань -- запис контенту в зовнішній ресурс належить T38
// (agent-worker/infra/resource-writer.ts) і T41, не сюди.
//
// Файл сам володіє CRUD над `sync_resource`, а не делегує в
// ../infra/postgres-repo.ts -- те T13-репо навмисно охоплює лише 5 СВОЇХ
// таблиць (agent_proposal/imperative_rule/long_term_memory_fact/
// chat_message/agent_audit_event, postgres-repo.ts §Notes), sync_resource -- її
// власна пізніша таблиця (migration 08, T31). Той самий підхід, що
// ../../agent-worker/infra/resource-writer.ts (T38) уже застосовує для тієї ж
// таблиці: локальний `Db`-контракт (query(text, params) -> {rows}), той самий
// формат, що й ../infra/postgres-repo.ts і всі сестринські repo (DI, ADR-0004).
//
// contracts/openapi.yaml (SyncResource/SyncResourceCreate,
// GET/POST/DELETE /api/v1/sync-resources):
// - AC-18 happy path: додати/прочитати список/прибрати ресурс, кожен запит
//   скерований на user_id у самому SQL (non-disclosure, той самий підхід, що
//   ../infra/postgres-repo.ts) -- чужий ресурс фізично відсутній у
//   результаті, не відфільтрований постфактум.
// - DoD T40 ("a malformed URL is rejected before any write"): `assertValidUrl`
//   виконується ПЕРШИМ рядком addSyncResource, кидає AppError ДО будь-якого
//   db.query -- дзеркалить create-card.ts (T9's CardValidationError кидається
//   до insertCard) і close-card.ts (structure.card_not_found до UPDATE).
// - Прибирання неіснучого/чужого ресурсу -- `sync_resource.not_found`, 404
//   (той самий шаблон коду помилки, що structure.card_not_found/
//   agent.proposal_not_found) -- контракт не називає конкретний код для 404
//   на DELETE, це найближче узгоджене з рештою API ім'я.
// - Фізичне видалення (DELETE), не м'яка архівація (openapi.yaml коментар:
//   "це лише список посилань, не дані користувача" -- на відміну від D-66/
//   D-68 м'якого архівування картки).

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../shared/errors';

/** Мінімальний контракт до бази, той самий, що й у сестринських repo/infra файлах. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type SyncResourceStatusRow = 'active' | 'error';

export interface SyncResourceRecord {
  id: string;
  userId: string;
  url: string;
  status: SyncResourceStatusRow;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

interface RawSyncResourceRow extends QueryResultRow {
  id: string;
  user_id: string;
  url: string;
  status: SyncResourceStatusRow;
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

function toRecord(row: RawSyncResourceRow): SyncResourceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

const SYNC_RESOURCE_COLUMNS = 'id, user_id, url, status, last_synced_at, last_error, created_at';

/**
 * DoD T40 / contract (sync_resource.url_invalid, 422): порожнє чи невалідне
 * посилання відхиляється ДО будь-якого запиту. `new URL(...)` вимагає
 * абсолютної адреси (сама по собі відхиляє порожній рядок і довільний
 * текст); протокол звужено до http(s) -- зовнішній ресурс (Google Doc/Sheet
 * тощо, spec.md US-12) відкривається браузером, інша схема (ftp:, mailto:
 * тощо) не є "посиланням на документ" у сенсі цієї фічі.
 */
function assertValidUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError('sync_resource.url_invalid', 'A valid resource URL is required', 422);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('sync_resource.url_invalid', 'A valid resource URL is required', 422);
  }
  return trimmed;
}

export interface AddSyncResourceInput {
  userId: string;
  url: string;
}

/** AC-18: додає ресурс синхронізації користувача, за замовчуванням status='active' (колонковий default). */
export async function addSyncResource(db: Db, input: AddSyncResourceInput): Promise<SyncResourceRecord> {
  const url = assertValidUrl(input.url);

  const { rows } = await db.query<RawSyncResourceRow>(
    `INSERT INTO sync_resource (id, user_id, url) VALUES ($1, $2, $3) RETURNING ${SYNC_RESOURCE_COLUMNS}`,
    [randomUUID(), input.userId, url]
  );
  return toRecord(rows[0]);
}

/** AC-18 (SCR-04 ResourceList): усі ресурси користувача, найновіші пізніше -- порядок додавання. */
export async function listSyncResources(db: Db, userId: string): Promise<SyncResourceRecord[]> {
  const { rows } = await db.query<RawSyncResourceRow>(
    `SELECT ${SYNC_RESOURCE_COLUMNS} FROM sync_resource WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows.map(toRecord);
}

/**
 * AC-18: прибирає ресурс синхронізації -- фізичне видалення (openapi.yaml).
 * Non-disclosure: WHERE звужує і на resourceId, і на userId в одному
 * запиті -- чужий ресурс ніколи не видаляється, і виклик про це навіть не
 * дізнається деталей (лише not_found), той самий шаблон, що updateProposal
 * (../infra/postgres-repo.ts) для чужого user_id.
 */
export async function removeSyncResource(db: Db, userId: string, resourceId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM sync_resource WHERE id = $1 AND user_id = $2 RETURNING id`,
    [resourceId, userId]
  );
  if (rows.length === 0) {
    throw new AppError('sync_resource.not_found', 'Ресурс синхронізації не знайдено', 404);
  }
}
