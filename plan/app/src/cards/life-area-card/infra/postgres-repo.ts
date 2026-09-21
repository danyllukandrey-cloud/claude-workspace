// Репозиторій над 4 таблицями життєвого циклу картки (T10): card, metric_block,
// entry, card_lifecycle_event -- ADR-0006, data-model.md.
//
// Правило залежностей (ADR-0004), той самий принцип DI, що й у local-cache.ts/
// claude-client.ts: цей файл ніколи сам не створює зʼєднання до бази. `Db`
// інжектується ззовні (composition root на сервері) -- підходить і pg.Pool,
// і pg.Client, обом досить методу .query з такою сигнатурою.
//
// Non-disclosure 404 (AC-04): КОЖЕН запит, що читає чи оновлює конкретну
// картку, скерований на owner_user_id -- "не існує" і "чужа" повертають
// однаковий null/порожній список, репозиторій фізично не має даних, щоб
// відповісти інакше (ADR-0006 §Обґрунтування).
//
// Один запит на кожен індекс з data-model.md §Indexes (7 штук):
//   idx_card_owner          -> listCardsByOwner
//   idx_card_owner_active   -> listActiveCardsByOwner
//   idx_metric_block_card   -> listMetricBlocksByCard
//   idx_entry_metric_block  -> listEntriesByMetricBlock
//   idx_entry_card_recorded -> listEntriesByCard (ORDER BY recorded_at DESC, AC-13)
//   idx_entry_card_pending  -> listPendingEntriesByCard (AC-11)
//   idx_lifecycle_card_time -> listLifecycleEventsByCard
//
// card_lifecycle_event -- лише запис (append-only, data-model.md Notes):
// жодного UPDATE/DELETE тут немає, лише insert + list.
//
// NUMERIC-колонки (amount, target_count) `pg` повертає рядком (щоб не
// втратити точність) -- репозиторій сам переводить їх у number на межі.

import type { QueryResultRow } from 'pg';

/** Мінімальний контракт до бази, який потрібен цьому репозиторію. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type CardStatusRow = 'active' | 'archived';
/** CH-02/CH-10 (docs/features/life-area-card/changes.md) -- "стан без вимірювань" / "постійний процес" (без цілі) / "з цілями та метриками". */
export type CardTrackingModeRow = 'state' | 'ongoing' | 'goals';
export type CardHealthStateRow = 'active' | 'critical' | 'paused';

export interface CardRecord {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  status: CardStatusRow;
  /** CH-02/CH-10: за замовчуванням 'goals' у БД (DEFAULT), тож рядки, застарілі за цю міграцію, читаються так само. */
  trackingMode: CardTrackingModeRow;
  /** CH-02: ненульове лише коли trackingMode === 'state'. */
  healthState: CardHealthStateRow | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MetricBlockStatusRow = 'active' | 'archived';

export interface MetricBlockRecord {
  id: string;
  cardId: string;
  label: string;
  unit: string;
  frequency: string | null;
  targetCount: number | null;
  isOngoing: boolean;
  targetDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** D-127 -- мʼяка архівація окремого блоку-метрики (US-17/AC-20), той самий підхід, що card.status. */
  status: MetricBlockStatusRow;
}

export type EntryStatusRow = 'pending' | 'confirmed' | 'rejected';

export interface EntryRecord {
  id: string;
  metricBlockId: string;
  cardId: string;
  amount: number;
  rawText: string | null;
  status: EntryStatusRow;
  sourceDeviceId: string | null;
  recordedAt: Date;
  confirmedAt: Date | null;
  createdAt: Date;
}

export type LifecycleTransitionRow = 'created' | 'filled' | 'in_use' | 'archived' | 'restored';

export interface LifecycleEventRecord {
  id: string;
  cardId: string;
  transition: LifecycleTransitionRow;
  occurredAt: Date;
}

// --- card --------------------------------------------------------------

interface RawCardRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  status: CardStatusRow;
  // CH-02: опційні -- тестові fixtures у репозиторії (десятки файлів, до цієї
  // зміни) конструюють "сирий рядок" вручну й не несуть цих двох полів;
  // toCardRecord() нижче дефолтить їх так само, як сама колонка в БД
  // (DEFAULT 'goals' / NULL), щоб не змушувати правити кожен fixture.
  tracking_mode?: CardTrackingModeRow;
  health_state?: CardHealthStateRow | null;
  created_at: Date;
  updated_at: Date;
}

function toCardRecord(row: RawCardRow): CardRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    trackingMode: row.tracking_mode ?? 'goals',
    healthState: row.health_state ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CARD_COLUMNS = 'id, owner_user_id, name, description, status, tracking_mode, health_state, created_at, updated_at';

export async function insertCard(
  db: Db,
  input: { id: string; ownerUserId: string; name: string; description?: string | null }
): Promise<CardRecord> {
  const { rows } = await db.query<RawCardRow>(
    `INSERT INTO card (id, owner_user_id, name, description) VALUES ($1, $2, $3, $4) RETURNING ${CARD_COLUMNS}`,
    [input.id, input.ownerUserId, input.name, input.description ?? null]
  );
  return toCardRecord(rows[0]);
}

/**
 * Postgres відхиляє значення, що не парситься як UUID, кодом помилки 22P02
 * ("invalid input syntax for type uuid") ЩЕ ДО порівняння WHERE -- фізично та
 * сама ситуація, що "рядка з таким id не існує" (жоден рядок не міг би
 * збігтись), тому non-disclosure (AC-04, коментар вище) трактує їх однаково.
 * Review 2026-09-07 (backend hardening, T50, "не-UUID id в шляху -- 500
 * замість 404"): без цього malformed path-параметр пробивав до generic
 * 500-гілки error-middleware (server/app.ts) замість контрактного 404, який
 * findXById-виклики й так дають для звичайного "не існує".
 */
function isInvalidUuidError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '22P02';
}

/** SELECT-обгортка для findXById-функцій нижче -- malformed uuid -> [] (те саме, що "рядків нема"), решта помилок пробрасуються як є. */
async function selectRowsOrEmptyOnInvalidUuid<T extends QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[]
): Promise<T[]> {
  try {
    const { rows } = await db.query<T>(text, params);
    return rows;
  } catch (err) {
    if (isInvalidUuidError(err)) return [];
    throw err;
  }
}

/** Non-disclosure (AC-04): чужа картка й неіснуюча картка повертають однаковий null. */
export async function findCardById(db: Db, ownerUserId: string, cardId: string): Promise<CardRecord | null> {
  const rows = await selectRowsOrEmptyOnInvalidUuid<RawCardRow>(
    db,
    `SELECT ${CARD_COLUMNS} FROM card WHERE id = $1 AND owner_user_id = $2`,
    [cardId, ownerUserId]
  );
  return rows[0] ? toCardRecord(rows[0]) : null;
}

/**
 * Часткове оновлення картки (T14 name/description, T15/T33 status archived<->active) --
 * лише передані поля міняються, решта лишається як була. Non-disclosure (AC-04):
 * чужа картка й неіснуюча повертають однаковий null, нічого не пишеться.
 */
export async function updateCard(
  db: Db,
  ownerUserId: string,
  cardId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: CardStatusRow;
    /** CH-02 (D-127-style same generic patch approach). */
    trackingMode?: CardTrackingModeRow;
    healthState?: CardHealthStateRow | null;
  }
): Promise<CardRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    values.push(patch.name);
    sets.push(`name = $${values.length}`);
  }
  if (patch.description !== undefined) {
    values.push(patch.description);
    sets.push(`description = $${values.length}`);
  }
  if (patch.status !== undefined) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (patch.trackingMode !== undefined) {
    values.push(patch.trackingMode);
    sets.push(`tracking_mode = $${values.length}`);
  }
  if (patch.healthState !== undefined) {
    values.push(patch.healthState);
    sets.push(`health_state = $${values.length}`);
  }
  if (sets.length === 0) {
    // Нічого змінювати -- non-disclosure все одно діє через звичайне читання.
    return findCardById(db, ownerUserId, cardId);
  }
  sets.push('updated_at = now()');

  values.push(cardId, ownerUserId);
  const { rows } = await db.query<RawCardRow>(
    `UPDATE card SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND owner_user_id = $${values.length} RETURNING ${CARD_COLUMNS}`,
    values
  );
  return rows[0] ? toCardRecord(rows[0]) : null;
}

/** idx_card_owner -- усі картки власника (AC-04). */
export async function listCardsByOwner(db: Db, ownerUserId: string): Promise<CardRecord[]> {
  const { rows } = await db.query<RawCardRow>(`SELECT ${CARD_COLUMNS} FROM card WHERE owner_user_id = $1`, [ownerUserId]);
  return rows.map(toCardRecord);
}

/** idx_card_owner_active -- лише активні картки колоди (AC-16, архівовані не показуються). */
export async function listActiveCardsByOwner(db: Db, ownerUserId: string): Promise<CardRecord[]> {
  const { rows } = await db.query<RawCardRow>(
    `SELECT ${CARD_COLUMNS} FROM card WHERE owner_user_id = $1 AND status = 'active'`,
    [ownerUserId]
  );
  return rows.map(toCardRecord);
}

/** idx_card_owner_archived (T32) -- перегляд архіву, найновіші зверху (AC-18, T34). */
export async function listArchivedCardsByOwner(db: Db, ownerUserId: string): Promise<CardRecord[]> {
  const { rows } = await db.query<RawCardRow>(
    `SELECT ${CARD_COLUMNS} FROM card WHERE owner_user_id = $1 AND status = 'archived' ORDER BY updated_at DESC`,
    [ownerUserId]
  );
  return rows.map(toCardRecord);
}

// --- metric_block --------------------------------------------------------

interface RawMetricBlockRow extends QueryResultRow {
  id: string;
  card_id: string;
  label: string;
  unit: string;
  frequency: string | null;
  target_count: string | null;
  is_ongoing: boolean;
  target_date: Date | null;
  created_at: Date;
  updated_at: Date;
  status: MetricBlockStatusRow;
}

function toMetricBlockRecord(row: RawMetricBlockRow): MetricBlockRecord {
  return {
    id: row.id,
    cardId: row.card_id,
    label: row.label,
    unit: row.unit,
    frequency: row.frequency,
    targetCount: row.target_count == null ? null : Number(row.target_count),
    isOngoing: row.is_ongoing,
    targetDate: row.target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
  };
}

const METRIC_BLOCK_COLUMNS =
  'id, card_id, label, unit, frequency, target_count, is_ongoing, target_date, created_at, updated_at, status';

export async function insertMetricBlock(
  db: Db,
  input: {
    id: string;
    cardId: string;
    label: string;
    unit: string;
    frequency?: string | null;
    targetCount?: number | null;
    isOngoing?: boolean;
    targetDate?: string | null;
  }
): Promise<MetricBlockRecord> {
  const { rows } = await db.query<RawMetricBlockRow>(
    `INSERT INTO metric_block (id, card_id, label, unit, frequency, target_count, is_ongoing, target_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${METRIC_BLOCK_COLUMNS}`,
    [
      input.id,
      input.cardId,
      input.label,
      input.unit,
      input.frequency ?? null,
      input.targetCount ?? null,
      input.isOngoing ?? false,
      input.targetDate ?? null,
    ]
  );
  return toMetricBlockRecord(rows[0]);
}

/** idx_metric_block_card -- усі блоки-метрики картки (AC-09, відкриття картки). */
export async function listMetricBlocksByCard(db: Db, cardId: string): Promise<MetricBlockRecord[]> {
  const { rows } = await db.query<RawMetricBlockRow>(`SELECT ${METRIC_BLOCK_COLUMNS} FROM metric_block WHERE card_id = $1`, [
    cardId,
  ]);
  return rows.map(toMetricBlockRecord);
}

/**
 * Часткове оновлення блоку-метрики (T17 -- переносить на іншу картку через
 * cardId, і/або перейменовує через label при колізії, AC-15; D-127 -- також
 * status для мʼякої архівації, US-17/AC-20). Той самий підхід, що й
 * card.updateCard: лише передані поля міняються, включно з тим, як updateCard
 * встановлює status.
 *
 * Non-disclosure тут НЕ репозиторію відповідальність -- metric_block не має
 * власного owner_user_id (лише через card), тому перевірку власності
 * (джерела й призначення при трансфері, чи єдиної картки при архівації)
 * робить use-case (T17, app/archive-metric-block.ts) через findCardById
 * ДО виклику цієї функції.
 */
export async function updateMetricBlock(
  db: Db,
  metricBlockId: string,
  patch: {
    cardId?: string;
    label?: string;
    unit?: string;
    frequency?: string | null;
    targetCount?: number | null;
    isOngoing?: boolean;
    targetDate?: string | null;
    status?: MetricBlockStatusRow;
  }
): Promise<MetricBlockRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.cardId !== undefined) assign('card_id', patch.cardId);
  if (patch.label !== undefined) assign('label', patch.label);
  if (patch.unit !== undefined) assign('unit', patch.unit);
  if (patch.frequency !== undefined) assign('frequency', patch.frequency);
  if (patch.targetCount !== undefined) assign('target_count', patch.targetCount);
  if (patch.isOngoing !== undefined) assign('is_ongoing', patch.isOngoing);
  if (patch.targetDate !== undefined) assign('target_date', patch.targetDate);
  if (patch.status !== undefined) assign('status', patch.status);

  if (sets.length === 0) {
    const { rows } = await db.query<RawMetricBlockRow>(
      `SELECT ${METRIC_BLOCK_COLUMNS} FROM metric_block WHERE id = $1`,
      [metricBlockId]
    );
    return rows[0] ? toMetricBlockRecord(rows[0]) : null;
  }
  sets.push('updated_at = now()');

  values.push(metricBlockId);
  const { rows } = await db.query<RawMetricBlockRow>(
    `UPDATE metric_block SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${METRIC_BLOCK_COLUMNS}`,
    values
  );
  return rows[0] ? toMetricBlockRecord(rows[0]) : null;
}

/**
 * Знаходить блок-метрику лише за власним id, без прив'язки до картки (T17, ISS-30) --
 * MetricBlockTransferRequest контракту передає лише sourceMetricBlockId, не картку,
 * з якої переносимо (бекенд сам визначає джерело, не довіряє заявленому викликачем --
 * саме так і задумано з самого початку, api-sync-report.md). Без власного
 * owner_user_id (лише через card, як і решта функцій цього блоку) -- перевірку
 * власності над карткою-джерелом (record.cardId) робить use-case, ПІСЛЯ цього виклику.
 * Той самий підхід повторює app/archive-metric-block.ts (D-127, US-17/AC-20) --
 * не довіряє client cardId зі шляху DELETE .../cards/{cardId}/metric-blocks/{metricBlockId}.
 */
export async function findMetricBlockById(db: Db, metricBlockId: string): Promise<MetricBlockRecord | null> {
  const rows = await selectRowsOrEmptyOnInvalidUuid<RawMetricBlockRow>(
    db,
    `SELECT ${METRIC_BLOCK_COLUMNS} FROM metric_block WHERE id = $1`,
    [metricBlockId]
  );
  return rows[0] ? toMetricBlockRecord(rows[0]) : null;
}

/**
 * Перевірка колізії назва+одиниця серед блоків картки-призначення (T17, AC-15) --
 * "без newLabel при колізії відхиляє, не зливає мовчки" перевіряється саме цим
 * читанням ДО перенесення.
 */
export async function findMetricBlockByCardLabelUnit(
  db: Db,
  cardId: string,
  label: string,
  unit: string
): Promise<MetricBlockRecord | null> {
  const { rows } = await db.query<RawMetricBlockRow>(
    `SELECT ${METRIC_BLOCK_COLUMNS} FROM metric_block WHERE card_id = $1 AND label = $2 AND unit = $3`,
    [cardId, label, unit]
  );
  return rows[0] ? toMetricBlockRecord(rows[0]) : null;
}

// --- entry -----------------------------------------------------------------

interface RawEntryRow extends QueryResultRow {
  id: string;
  metric_block_id: string;
  card_id: string;
  amount: string;
  raw_text: string | null;
  status: EntryStatusRow;
  source_device_id: string | null;
  recorded_at: Date;
  confirmed_at: Date | null;
  created_at: Date;
}

function toEntryRecord(row: RawEntryRow): EntryRecord {
  return {
    id: row.id,
    metricBlockId: row.metric_block_id,
    cardId: row.card_id,
    amount: Number(row.amount),
    rawText: row.raw_text,
    status: row.status,
    sourceDeviceId: row.source_device_id,
    recordedAt: row.recorded_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

const ENTRY_COLUMNS = 'id, metric_block_id, card_id, amount, raw_text, status, source_device_id, recorded_at, confirmed_at, created_at';

export async function insertEntry(
  db: Db,
  input: {
    id: string;
    metricBlockId: string;
    cardId: string;
    amount: number;
    rawText?: string | null;
    status?: EntryStatusRow;
    sourceDeviceId?: string | null;
  }
): Promise<EntryRecord> {
  const { rows } = await db.query<RawEntryRow>(
    `INSERT INTO entry (id, metric_block_id, card_id, amount, raw_text, status, source_device_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${ENTRY_COLUMNS}`,
    [
      input.id,
      input.metricBlockId,
      input.cardId,
      input.amount,
      input.rawText ?? null,
      input.status ?? 'confirmed',
      input.sourceDeviceId ?? null,
    ]
  );
  return toEntryRecord(rows[0]);
}

/**
 * Знаходить запис лише за власним id, без прив'язки до картки (T19, ISS-32) --
 * PATCH /entries/{entryId} контракту передає лише entryId, не картку -- бекенд
 * сам визначає, якій картці він належить (record.cardId), не довіряючи
 * заявленому викликачем значенню (той самий підхід, що findMetricBlockById для T17).
 * Без власного owner_user_id (лише через card) -- перевірку власності над
 * карткою робить use-case, ПІСЛЯ цього виклику.
 */
export async function findEntryById(db: Db, entryId: string): Promise<EntryRecord | null> {
  const rows = await selectRowsOrEmptyOnInvalidUuid<RawEntryRow>(db, `SELECT ${ENTRY_COLUMNS} FROM entry WHERE id = $1`, [
    entryId,
  ]);
  return rows[0] ? toEntryRecord(rows[0]) : null;
}

/** idx_entry_metric_block -- сирі записи блоку для перерахунку прогресу (ADR-0001). */
export async function listEntriesByMetricBlock(db: Db, metricBlockId: string): Promise<EntryRecord[]> {
  const { rows } = await db.query<RawEntryRow>(`SELECT ${ENTRY_COLUMNS} FROM entry WHERE metric_block_id = $1`, [
    metricBlockId,
  ]);
  return rows.map(toEntryRecord);
}

/** idx_entry_card_recorded -- історія картки, найновіші зверху (AC-13). */
export async function listEntriesByCard(db: Db, cardId: string): Promise<EntryRecord[]> {
  const { rows } = await db.query<RawEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM entry WHERE card_id = $1 ORDER BY recorded_at DESC`,
    [cardId]
  );
  return rows.map(toEntryRecord);
}

/** idx_entry_card_pending -- неперевірені записи, коли агент повертається (AC-11). */
export async function listPendingEntriesByCard(db: Db, cardId: string): Promise<EntryRecord[]> {
  const { rows } = await db.query<RawEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM entry WHERE card_id = $1 AND status = 'pending'`,
    [cardId]
  );
  return rows.map(toEntryRecord);
}

/**
 * Переводить статус запису (T19 -- вирішення конфлікту AC-06, підтвердження
 * після повернення агента AC-11, виправлення з історії AC-12). confirmed_at
 * виставляється, коли статус переходить у confirmed чи rejected
 * (data-model.md) -- НІКОЛИ не видаляє рядок, лише позначає (ADR-0002).
 */
export async function updateEntryStatus(db: Db, entryId: string, status: EntryStatusRow): Promise<EntryRecord | null> {
  const { rows } = await db.query<RawEntryRow>(
    `UPDATE entry
     SET status = $1, confirmed_at = CASE WHEN $1 IN ('confirmed', 'rejected') THEN now() ELSE confirmed_at END
     WHERE id = $2 RETURNING ${ENTRY_COLUMNS}`,
    [status, entryId]
  );
  return rows[0] ? toEntryRecord(rows[0]) : null;
}

/**
 * Переносить ВСІ записи блоку-метрики на нову картку (T17, AC-14) --
 * entry.card_id денормалізовано для швидкого читання історії (data-model.md),
 * тому перенесення блоку саме по собі НЕ рухає його записи: цей виклик
 * обов'язковий у парі з updateMetricBlock({cardId}), інакше історія й
 * прогрес на новій картці не побачать перенесені дані.
 */
export async function reassignEntriesToCard(db: Db, metricBlockId: string, newCardId: string): Promise<void> {
  await db.query(`UPDATE entry SET card_id = $1 WHERE metric_block_id = $2`, [newCardId, metricBlockId]);
}

// --- card_lifecycle_event ----------------------------------------------
// Append-only (data-model.md Notes) -- жодного update/delete нижче навмисно.

interface RawLifecycleEventRow extends QueryResultRow {
  id: string;
  card_id: string;
  transition: LifecycleTransitionRow;
  occurred_at: Date;
}

function toLifecycleEventRecord(row: RawLifecycleEventRow): LifecycleEventRecord {
  return { id: row.id, cardId: row.card_id, transition: row.transition, occurredAt: row.occurred_at };
}

const LIFECYCLE_EVENT_COLUMNS = 'id, card_id, transition, occurred_at';

export async function insertLifecycleEvent(
  db: Db,
  input: { id: string; cardId: string; transition: LifecycleTransitionRow }
): Promise<LifecycleEventRecord> {
  const { rows } = await db.query<RawLifecycleEventRow>(
    `INSERT INTO card_lifecycle_event (id, card_id, transition) VALUES ($1, $2, $3) RETURNING ${LIFECYCLE_EVENT_COLUMNS}`,
    [input.id, input.cardId, input.transition]
  );
  return toLifecycleEventRecord(rows[0]);
}

/** idx_lifecycle_card_time -- журнал переходів картки, за часом (spec.md §7 KPI). */
export async function listLifecycleEventsByCard(db: Db, cardId: string): Promise<LifecycleEventRecord[]> {
  const { rows } = await db.query<RawLifecycleEventRow>(
    `SELECT ${LIFECYCLE_EVENT_COLUMNS} FROM card_lifecycle_event WHERE card_id = $1 ORDER BY occurred_at`,
    [cardId]
  );
  return rows.map(toLifecycleEventRecord);
}
