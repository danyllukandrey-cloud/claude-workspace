// Мінімальний зріз репозиторію `structure` -- НЕ повний T9 ("Infra: backend
// repository for structure + layout positions"), лише одна функція, потрібна
// щоб закрити D-69/D-103: коли картку архівують, її активна позиція в
// розкладці Структури закривається в тій самій транзакції.
//
// `structure` як фіча ще не пройшла /sdd:implement (tasks.json T4-T25 усе
// ще todo) -- ця функція навмисно випереджає власну чергу фічі, так само,
// як agent's app_user (migration 01) був промоучений заради life-area-card's
// card.owner_user_id ще до першого рядка коду agent. Коли дійде черга T9,
// цей файл розшириться (CRUD над structure + layout positions), а не
// перепишеться -- сигнатура нижче лишається чинною.
//
// DI (ADR-0004): той самий Db-контракт, що й у life-area-card/infra/
// postgres-repo.ts (query(text, params) -> {rows}) -- підходить і pg.Pool,
// і pg.Client, і той самий обʼєкт, який life-area-card вже використовує
// в одній транзакції з archiveCard.

import type { QueryResultRow } from 'pg';

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Закриває активну позицію картки в розкладці Структури (D-69, AC-16) --
 * status: 'active' -> 'closed'. Якщо активної позиції немає (картка ще не
 * розкладена, чи вже закрита раніше через structure's власний closeCard,
 * D-66) -- це НЕ помилка, просто нічого закривати. Не повертає результат:
 * викликачу (archiveCard) байдуже, чи існувала позиція, лише сам факт
 * "якщо була активна -- тепер закрита".
 */
export async function closeActiveLayoutPositionForCard(db: Db, cardId: string): Promise<void> {
  await db.query(
    `UPDATE structure_layout_position
     SET status = 'closed', position_updated_at = now()
     WHERE card_id = $1 AND status = 'active'`,
    [cardId]
  );
}

// T9 -- решта репозиторію (CRUD над `structure` + `structure_layout_position`,
// AC-03/08/09/12, data-model.md). Той самий DI-контракт `Db` вище, той самий
// стиль (RETURNING на write, camelCase-мапінг на межі) що й
// life-area-card/infra/postgres-repo.ts.
//
// Вимоги 14/15 (Андрій, чат), staged-міграція 07_flatten_layout_mode -- ОДНЕ
// поле з 5 значеннями замість layout_mode('single'|'free'|'logic') +
// logic_variant('balance'|'focus'|'cause_effect') (два поля). Колишні три
// підвиди стають топ-рівневими значеннями, 'single' скасований, 'staging' --
// новий.
export type LayoutModeRow = 'balance' | 'focus' | 'cause_effect' | 'free' | 'staging';
export type LayoutPositionStatusRow = 'active' | 'closed';

export interface StructureRecord {
  id: string;
  ownerUserId: string;
  declaration: string | null;
  layoutMode: LayoutModeRow | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutPositionRecord {
  id: string;
  structureId: string;
  cardId: string;
  // Вільне полотно (D-131-наступне рішення, Андрій у чаті, 2026-09-15):
  // cellIndex прибраний повністю -- позиція картки тепер {x, y}, відсоток
  // канви (0-100). NULL/NULL = "картка без позиції" (купка нерозкладених),
  // той самий принцип, що cellIndex мав до цього переписування.
  x: number | null;
  y: number | null;
  status: LayoutPositionStatusRow;
  positionUpdatedAt: Date;
  createdAt: Date;
}

// --- structure -----------------------------------------------------------

interface RawStructureRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  declaration: string | null;
  layout_mode: LayoutModeRow | null;
  created_at: Date;
  updated_at: Date;
}

function toStructureRecord(row: RawStructureRow): StructureRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    declaration: row.declaration,
    layoutMode: row.layout_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STRUCTURE_COLUMNS = 'id, owner_user_id, declaration, layout_mode, created_at, updated_at';

/** Non-disclosure (AC-03): чужа Структура й неіснуюча повертають однаковий null. */
export async function findStructureByOwner(db: Db, ownerUserId: string): Promise<StructureRecord | null> {
  const { rows } = await db.query<RawStructureRow>(
    `SELECT ${STRUCTURE_COLUMNS} FROM structure WHERE owner_user_id = $1`,
    [ownerUserId]
  );
  return rows[0] ? toStructureRecord(rows[0]) : null;
}

export async function insertStructure(
  db: Db,
  input: {
    id: string;
    ownerUserId: string;
    declaration?: string | null;
    layoutMode?: LayoutModeRow | null;
  }
): Promise<StructureRecord> {
  const { rows } = await db.query<RawStructureRow>(
    `INSERT INTO structure (id, owner_user_id, declaration, layout_mode)
     VALUES ($1, $2, $3, $4) RETURNING ${STRUCTURE_COLUMNS}`,
    [input.id, input.ownerUserId, input.declaration ?? null, input.layoutMode ?? null]
  );
  return toStructureRecord(rows[0]);
}

/**
 * Часткове оновлення Структури (AC-10 декларація, AC-11/AC-11b режим
 * розкладки) -- лише передані поля міняються. Non-disclosure (AC-03): чужий
 * owner_user_id повертає null, нічого не пишеться.
 */
export async function updateStructure(
  db: Db,
  ownerUserId: string,
  patch: { declaration?: string | null; layoutMode?: LayoutModeRow | null }
): Promise<StructureRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.declaration !== undefined) assign('declaration', patch.declaration);
  if (patch.layoutMode !== undefined) assign('layout_mode', patch.layoutMode);

  if (sets.length === 0) {
    return findStructureByOwner(db, ownerUserId);
  }
  sets.push('updated_at = now()');

  values.push(ownerUserId);
  const { rows } = await db.query<RawStructureRow>(
    `UPDATE structure SET ${sets.join(', ')} WHERE owner_user_id = $${values.length} RETURNING ${STRUCTURE_COLUMNS}`,
    values
  );
  return rows[0] ? toStructureRecord(rows[0]) : null;
}

// --- structure_layout_position --------------------------------------------

interface RawLayoutPositionRow extends QueryResultRow {
  id: string;
  structure_id: string;
  card_id: string;
  position_x: number | null;
  position_y: number | null;
  status: LayoutPositionStatusRow;
  position_updated_at: Date;
  created_at: Date;
}

function toLayoutPositionRecord(row: RawLayoutPositionRow): LayoutPositionRecord {
  return {
    id: row.id,
    structureId: row.structure_id,
    cardId: row.card_id,
    x: row.position_x,
    y: row.position_y,
    status: row.status,
    positionUpdatedAt: row.position_updated_at,
    createdAt: row.created_at,
  };
}

const LAYOUT_POSITION_COLUMNS = 'id, structure_id, card_id, position_x, position_y, status, position_updated_at, created_at';

/**
 * ISS-101/D-117: щойно авто-розкладена позиція (нова картка, ще жодного разу
 * НЕ переміщена користувачем) навмисно отримує свідомо старий `position_updated_at`
 * замість дефолту `now()` колонки. Причина -- `resolvePositionConflict`
 * (domain/layout.ts, ADR-0002) порівнює час БД (цей запис) з часом клієнта
 * (перше ж перетягування) напряму, без толерантності: будь-яка розбіжність
 * годинників клієнт/сервер (виміряно ~54мс проти dev Neon) робила щойно
 * створену позицію "новішою" за перше реальне переміщення користувача --
 * переміщення тихо ігнорувалось, без помилки (move-card.integration.test.ts).
 * Сентинел-час 1970 гарантує, що ПЕРШЕ реальне переміщення завжди виграє,
 * незалежно від розбіжності годинників -- саму функцію resolvePositionConflict
 * і реальний конфлікт двох пристроїв (ADR-0002) це не чіпає: там обидва боки
 * порівняння вже мають "справжні", недавні часові мітки.
 */
const NEVER_MOVED_SENTINEL = new Date(0);

export async function insertLayoutPosition(
  db: Db,
  // x/y: null -- нова картка завжди йде прямо в купку нерозкладених, вільне
  // позиціювання прибрало поняття "наступна вільна клітинка"
  // (defaultPositionForNewCard, domain/layout.ts).
  input: { id: string; structureId: string; cardId: string; x: number | null; y: number | null }
): Promise<LayoutPositionRecord> {
  const { rows } = await db.query<RawLayoutPositionRow>(
    `INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y, position_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${LAYOUT_POSITION_COLUMNS}`,
    [input.id, input.structureId, input.cardId, input.x, input.y, NEVER_MOVED_SENTINEL]
  );
  return toLayoutPositionRecord(rows[0]);
}

/**
 * Активні позиції власника (AC-08/AC-09) -- owner_user_id живе на `structure`,
 * не на `structure_layout_position` (data-model.md), тому scoping тут -- join
 * назад до `structure`, а не власна колонка.
 */
export async function listActiveLayoutPositionsByOwner(db: Db, ownerUserId: string): Promise<LayoutPositionRecord[]> {
  const { rows } = await db.query<RawLayoutPositionRow>(
    `SELECT p.id, p.structure_id, p.card_id, p.position_x, p.position_y, p.status, p.position_updated_at, p.created_at
     FROM structure_layout_position p
     JOIN structure s ON s.id = p.structure_id
     WHERE s.owner_user_id = $1 AND p.status = 'active'`,
    [ownerUserId]
  );
  return rows.map(toLayoutPositionRecord);
}

/**
 * Перетягування картки на нову позицію канви (AC-08, збереження одразу
 * після відпускання). Non-disclosure (AC-03): чужий owner_user_id -- null,
 * нічого не рухається й не розкривається.
 *
 * `x`/`y`: null -- "картка без позиції" (купка нерозкладених) -- параметр
 * лягає СПРАВЖНІМ SQL NULL (pg біндить JS null як NULL), тому окремого
 * запиту не треба. x/y завжди приходять разом (обидва числа чи обидва null)
 * -- викликач (app/move-card.ts, app/apply-layout-mode.ts) гарантує пару.
 */
export async function updateLayoutPositionXY(
  db: Db,
  ownerUserId: string,
  cardId: string,
  x: number | null,
  y: number | null,
  positionUpdatedAt: string | Date
): Promise<LayoutPositionRecord | null> {
  const { rows } = await db.query<RawLayoutPositionRow>(
    `UPDATE structure_layout_position p
     SET position_x = $1, position_y = $2, position_updated_at = $3
     WHERE p.card_id = $4 AND p.status = 'active'
       AND p.structure_id IN (SELECT id FROM structure WHERE owner_user_id = $5)
     RETURNING ${LAYOUT_POSITION_COLUMNS}`,
    [x, y, positionUpdatedAt, cardId, ownerUserId]
  );
  return rows[0] ? toLayoutPositionRecord(rows[0]) : null;
}

// --- structure_connection ---------------------------------------------------
//
// Вимоги 4/5 (Андрій, чат): інструмент "Зв'язати" створює/розриває зв'язки
// між картками -- звичайну лінію (directed: false) чи стрілку (directed:
// true, card_id_a -> card_id_b). Той самий DI/стиль (RETURNING, camelCase-
// мапінг на межі), що structure_layout_position вище.

export interface ConnectionRecord {
  id: string;
  structureId: string;
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
  createdAt: Date;
}

interface RawConnectionRow extends QueryResultRow {
  id: string;
  structure_id: string;
  card_id_a: string;
  card_id_b: string;
  directed: boolean;
  created_at: Date;
}

function toConnectionRecord(row: RawConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    structureId: row.structure_id,
    cardIdA: row.card_id_a,
    cardIdB: row.card_id_b,
    directed: row.directed,
    createdAt: row.created_at,
  };
}

const CONNECTION_COLUMNS = 'id, structure_id, card_id_a, card_id_b, directed, created_at';

export async function insertConnection(
  db: Db,
  input: { id: string; structureId: string; cardIdA: string; cardIdB: string; directed: boolean }
): Promise<ConnectionRecord> {
  const { rows } = await db.query<RawConnectionRow>(
    `INSERT INTO structure_connection (id, structure_id, card_id_a, card_id_b, directed)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${CONNECTION_COLUMNS}`,
    [input.id, input.structureId, input.cardIdA, input.cardIdB, input.directed]
  );
  return toConnectionRecord(rows[0]);
}

/** Owner-scoped (AC-03 non-disclosure pattern -- той самий join, що listActiveLayoutPositionsByOwner). */
export async function listConnectionsByOwner(db: Db, ownerUserId: string): Promise<ConnectionRecord[]> {
  const { rows } = await db.query<RawConnectionRow>(
    `SELECT c.id, c.structure_id, c.card_id_a, c.card_id_b, c.directed, c.created_at
     FROM structure_connection c
     JOIN structure s ON s.id = c.structure_id
     WHERE s.owner_user_id = $1`,
    [ownerUserId]
  );
  return rows.map(toConnectionRecord);
}

/** Owner-scoped delete -- non-disclosure (AC-03): чужий/неіснуючий зв'язок повертає false, нічого не розкриває. */
export async function deleteConnection(db: Db, ownerUserId: string, connectionId: string): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM structure_connection c
     USING structure s
     WHERE c.id = $1 AND c.structure_id = s.id AND s.owner_user_id = $2
     RETURNING c.id`,
    [connectionId, ownerUserId]
  );
  return rows.length > 0;
}

/**
 * Замінює ВСІ зв'язки Структури на новий план авто-розкладу
 * (app/apply-layout-mode.ts) -- DELETE+INSERT через ТОЙ САМИЙ переданий `db`,
 * атомарність (одна транзакція разом з N UPDATE позицій) лишається за
 * composition root (withTransaction, ADR-0006), той самий підхід, що
 * update-structure.ts вже застосовує для reset-у позицій.
 */
export async function replaceConnectionsForStructure(
  db: Db,
  structureId: string,
  connections: { id: string; cardIdA: string; cardIdB: string; directed: boolean }[]
): Promise<void> {
  await db.query('DELETE FROM structure_connection WHERE structure_id = $1', [structureId]);
  for (const connection of connections) {
    await db.query(
      `INSERT INTO structure_connection (id, structure_id, card_id_a, card_id_b, directed)
       VALUES ($1, $2, $3, $4, $5)`,
      [connection.id, structureId, connection.cardIdA, connection.cardIdB, connection.directed]
    );
  }
}
