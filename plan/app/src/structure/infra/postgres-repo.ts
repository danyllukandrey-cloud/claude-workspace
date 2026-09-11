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
// AC-03/08/09/12/16, data-model.md). Той самий DI-контракт `Db` вище, той самий
// стиль (RETURNING на write, camelCase-мапінг на межі) що й
// life-area-card/infra/postgres-repo.ts.

export type LayoutModeRow = 'single' | 'free' | 'logic';
export type LogicVariantRow = 'balance' | 'focus' | 'cause_effect';
export type LayoutPositionStatusRow = 'active' | 'closed';

export interface StructureRecord {
  id: string;
  ownerUserId: string;
  declaration: string | null;
  layoutMode: LayoutModeRow | null;
  logicVariant: LogicVariantRow | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutPositionRecord {
  id: string;
  structureId: string;
  cardId: string;
  cellIndex: number;
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
  logic_variant: LogicVariantRow | null;
  created_at: Date;
  updated_at: Date;
}

function toStructureRecord(row: RawStructureRow): StructureRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    declaration: row.declaration,
    layoutMode: row.layout_mode,
    logicVariant: row.logic_variant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STRUCTURE_COLUMNS = 'id, owner_user_id, declaration, layout_mode, logic_variant, created_at, updated_at';

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
    logicVariant?: LogicVariantRow | null;
  }
): Promise<StructureRecord> {
  const { rows } = await db.query<RawStructureRow>(
    `INSERT INTO structure (id, owner_user_id, declaration, layout_mode, logic_variant)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${STRUCTURE_COLUMNS}`,
    [input.id, input.ownerUserId, input.declaration ?? null, input.layoutMode ?? null, input.logicVariant ?? null]
  );
  return toStructureRecord(rows[0]);
}

/**
 * Часткове оновлення Структури (AC-10 декларація, AC-11/AC-11b режим
 * розкладки, AC-16 subvariant) -- лише передані поля міняються. Non-disclosure
 * (AC-03): чужий owner_user_id повертає null, нічого не пишеться.
 */
export async function updateStructure(
  db: Db,
  ownerUserId: string,
  patch: { declaration?: string | null; layoutMode?: LayoutModeRow | null; logicVariant?: LogicVariantRow | null }
): Promise<StructureRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.declaration !== undefined) assign('declaration', patch.declaration);
  if (patch.layoutMode !== undefined) assign('layout_mode', patch.layoutMode);
  if (patch.logicVariant !== undefined) assign('logic_variant', patch.logicVariant);

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
  cell_index: number;
  status: LayoutPositionStatusRow;
  position_updated_at: Date;
  created_at: Date;
}

function toLayoutPositionRecord(row: RawLayoutPositionRow): LayoutPositionRecord {
  return {
    id: row.id,
    structureId: row.structure_id,
    cardId: row.card_id,
    cellIndex: row.cell_index,
    status: row.status,
    positionUpdatedAt: row.position_updated_at,
    createdAt: row.created_at,
  };
}

const LAYOUT_POSITION_COLUMNS = 'id, structure_id, card_id, cell_index, status, position_updated_at, created_at';

export async function insertLayoutPosition(
  db: Db,
  input: { id: string; structureId: string; cardId: string; cellIndex: number }
): Promise<LayoutPositionRecord> {
  const { rows } = await db.query<RawLayoutPositionRow>(
    `INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index)
     VALUES ($1, $2, $3, $4) RETURNING ${LAYOUT_POSITION_COLUMNS}`,
    [input.id, input.structureId, input.cardId, input.cellIndex]
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
    `SELECT p.id, p.structure_id, p.card_id, p.cell_index, p.status, p.position_updated_at, p.created_at
     FROM structure_layout_position p
     JOIN structure s ON s.id = p.structure_id
     WHERE s.owner_user_id = $1 AND p.status = 'active'`,
    [ownerUserId]
  );
  return rows.map(toLayoutPositionRecord);
}

/**
 * Перетягування картки в нову клітинку (AC-08, збереження одразу після
 * відпускання). Non-disclosure (AC-03): чужий owner_user_id -- null, нічого
 * не рухається й не розкривається.
 */
export async function updateLayoutPositionCell(
  db: Db,
  ownerUserId: string,
  cardId: string,
  cellIndex: number,
  positionUpdatedAt: string | Date
): Promise<LayoutPositionRecord | null> {
  const { rows } = await db.query<RawLayoutPositionRow>(
    `UPDATE structure_layout_position p
     SET cell_index = $1, position_updated_at = $2
     WHERE p.card_id = $3 AND p.status = 'active'
       AND p.structure_id IN (SELECT id FROM structure WHERE owner_user_id = $4)
     RETURNING ${LAYOUT_POSITION_COLUMNS}`,
    [cellIndex, positionUpdatedAt, cardId, ownerUserId]
  );
  return rows[0] ? toLayoutPositionRecord(rows[0]) : null;
}
