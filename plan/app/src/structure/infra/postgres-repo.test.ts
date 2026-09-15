// T9 -- Infra: backend repository for structure + layout positions + connections.
// RED (unit level, mocked Db): AC-03/AC-08/AC-09/AC-12.
//
// Real DB round-trip is exercised against the shared Postgres already wired
// for this module's other integration coverage -- out of scope for this
// task's files_hint (postgres-repo.ts only), left for the integration-level
// extension of that shared suite.
//
// Same mocking convention as
// ../../cards/life-area-card/infra/postgres-repo.test.ts: fake `Db.query`
// (vi.fn), assert both the SQL text (owner_user_id scoping) and the mapped
// return shape (camelCase).
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): "Прибрати повністю оті
// клітинки" -- cell_index прибраний, позиція картки тепер {x, y} (відсоток
// канви), і додана нова таблиця structure_connection (вимоги 4/5).

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './postgres-repo';
import {
  findStructureByOwner,
  insertStructure,
  updateStructure,
  insertLayoutPosition,
  listActiveLayoutPositionsByOwner,
  updateLayoutPositionXY,
  insertConnection,
  listConnectionsByOwner,
  deleteConnection,
  replaceConnectionsForStructure,
} from './postgres-repo';

function rawStructureRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'structure-1',
    owner_user_id: 'owner-1',
    declaration: null,
    layout_mode: 'focus',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function rawLayoutPositionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'position-1',
    structure_id: 'structure-1',
    card_id: 'card-1',
    position_x: 42,
    position_y: 17,
    status: 'active',
    position_updated_at: new Date('2026-01-03T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function rawConnectionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'connection-1',
    structure_id: 'structure-1',
    card_id_a: 'card-1',
    card_id_b: 'card-2',
    directed: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('findStructureByOwner -- AC-03 (non-disclosure)', () => {
  it('scopes the SELECT by owner_user_id and maps layout_mode onto layoutMode', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawStructureRow()] });
    const db: Db = { query };

    const found = await findStructureByOwner(db, 'owner-1');

    expect(found).toEqual({
      id: 'structure-1',
      ownerUserId: 'owner-1',
      declaration: null,
      layoutMode: 'focus',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toEqual(['owner-1']);
  });

  it('a mismatched owner_user_id is never returned -- same outcome as "does not exist" (AC-03)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(findStructureByOwner(db, 'someone-elses-owner-id')).resolves.toBeNull();
  });
});

describe('insertStructure -- writes layoutMode', () => {
  it('persists layoutMode and returns the camelCase record', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawStructureRow({ declaration: 'картина світу' })],
    });
    const db: Db = { query };

    const created = await insertStructure(db, {
      id: 'structure-1',
      ownerUserId: 'owner-1',
      declaration: 'картина світу',
      layoutMode: 'focus',
    });

    expect(created.layoutMode).toBe('focus');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/layout_mode/);
    expect(params).toContain('focus');
  });
});

describe('updateStructure -- AC-10/AC-11 partial write, scoped by owner (AC-03)', () => {
  it('updates declaration/layoutMode scoped to the given owner_user_id', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawStructureRow({ declaration: 'нова декларація', layout_mode: 'balance' })],
    });
    const db: Db = { query };

    const updated = await updateStructure(db, 'owner-1', {
      declaration: 'нова декларація',
      layoutMode: 'balance',
    });

    expect(updated?.layoutMode).toBe('balance');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toContain('owner-1');
  });

  it('a caller passing someone else\'s owner_user_id gets null, not another owner\'s row (AC-03)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      updateStructure(db, 'attacker-owner-id', { declaration: 'спроба чужого запису' })
    ).resolves.toBeNull();
  });
});

describe('insertLayoutPosition + listActiveLayoutPositionsByOwner -- AC-08/AC-09 read-your-own-writes', () => {
  it('a newly inserted position is scoped to structure_id and returned on the next owner-scoped read', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow()] });
    const dbForInsert: Db = { query: insertQuery };

    const inserted = await insertLayoutPosition(dbForInsert, {
      id: 'position-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      x: 42,
      y: 17,
    });
    expect(inserted).toEqual({
      id: 'position-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      x: 42,
      y: 17,
      status: 'active',
      positionUpdatedAt: new Date('2026-01-03T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const listQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow()] });
    const dbForList: Db = { query: listQuery };

    const positions = await listActiveLayoutPositionsByOwner(dbForList, 'owner-1');
    expect(positions).toHaveLength(1);
    expect(positions[0].x).toBe(42);
    expect(positions[0].y).toBe(17);

    // Owner scoping happens via a join back to structure.owner_user_id --
    // the query text must mention owner_user_id even though the column lives
    // on `structure`, not `structure_layout_position` (data-model.md).
    const [listSql, listParams] = listQuery.mock.calls[0];
    expect(listSql).toMatch(/owner_user_id/);
    expect(listParams).toEqual(['owner-1']);
  });

  // Вільне позиціювання: нова картка завжди йде в купку нерозкладених --
  // x/y обидва null.
  it('inserts a new, unplaced card with x: null and y: null (the tray)', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow({ position_x: null, position_y: null })] });
    const db: Db = { query: insertQuery };

    await insertLayoutPosition(db, { id: 'position-1', structureId: 'structure-1', cardId: 'card-1', x: null, y: null });

    const [, params] = insertQuery.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
  });

  // ISS-101/D-117: авто-розкладена позиція (нова картка) пишеться зі свідомо
  // старим position_updated_at (епоха, 1970), не з дефолту now() колонки --
  // інакше перше ж реальне переміщення користувача могло тихо програти через
  // розбіжність годинників клієнт/БД (виміряно ~54мс проти dev Neon).
  it('writes a sentinel (epoch) position_updated_at instead of relying on the column default now()', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow()] });
    const db: Db = { query: insertQuery };

    await insertLayoutPosition(db, { id: 'position-1', structureId: 'structure-1', cardId: 'card-1', x: 42, y: 17 });

    const [sql, params] = insertQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/position_updated_at/);
    expect(params).toEqual(['position-1', 'structure-1', 'card-1', 42, 17, new Date(0)]);
  });

  it('a card with no active position at all is simply absent from the list -- AC-09 places no forced placeholder row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(listActiveLayoutPositionsByOwner(db, 'owner-1')).resolves.toEqual([]);
  });
});

describe('updateLayoutPositionXY -- AC-08 drag-and-drop save, scoped by owner (AC-03)', () => {
  it('moves the card to the new x/y and returns it when the position belongs to the given owner', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawLayoutPositionRow({ position_x: 65, position_y: 80 })],
    });
    const db: Db = { query };

    const moved = await updateLayoutPositionXY(db, 'owner-1', 'card-1', 65, 80, '2026-01-04T00:00:00Z');

    expect(moved?.x).toBe(65);
    expect(moved?.y).toBe(80);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toContain('owner-1');
  });

  // "Картка без позиції" (купка нерозкладених) мусить доїхати до БД
  // справжнім SQL NULL, не рядком 'null'.
  it('binds x/y as a real SQL NULL when the card is reset to "no position"', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow({ position_x: null, position_y: null })] });
    const db: Db = { query };

    await updateLayoutPositionXY(db, 'owner-1', 'card-1', null, null, '2026-01-04T00:00:00Z');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/position_x\s*=\s*\$\d/);
    expect(sql).toMatch(/position_y\s*=\s*\$\d/);
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
    expect(params).not.toContain('null');
  });

  it('a mismatched owner_user_id never moves nor discloses another owner\'s card position (AC-03)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      updateLayoutPositionXY(db, 'attacker-owner-id', 'card-1', 65, 80, '2026-01-04T00:00:00Z')
    ).resolves.toBeNull();
  });
});

// --- structure_connection (вимоги 4/5, чат) ---------------------------------

describe('insertConnection + listConnectionsByOwner -- AC-03 owner scoping', () => {
  it('a newly inserted connection is scoped to structure_id and returned on the next owner-scoped read', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawConnectionRow()] });
    const inserted = await insertConnection(
      { query: insertQuery },
      { id: 'connection-1', structureId: 'structure-1', cardIdA: 'card-1', cardIdB: 'card-2', directed: false }
    );
    expect(inserted).toEqual({
      id: 'connection-1',
      structureId: 'structure-1',
      cardIdA: 'card-1',
      cardIdB: 'card-2',
      directed: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const listQuery = vi.fn().mockResolvedValue({ rows: [rawConnectionRow()] });
    const connections = await listConnectionsByOwner({ query: listQuery }, 'owner-1');
    expect(connections).toHaveLength(1);
    expect(connections[0].directed).toBe(false);

    const [listSql, listParams] = listQuery.mock.calls[0];
    expect(listSql).toMatch(/owner_user_id/);
    expect(listParams).toEqual(['owner-1']);
  });

  it('persists a directed connection (arrow) with directed: true', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawConnectionRow({ directed: true })] });
    const inserted = await insertConnection(
      { query: insertQuery },
      { id: 'connection-1', structureId: 'structure-1', cardIdA: 'card-1', cardIdB: 'card-2', directed: true }
    );
    expect(inserted.directed).toBe(true);
    const [, params] = insertQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(true);
  });
});

describe('deleteConnection -- owner-scoped, non-disclosure (AC-03)', () => {
  it('deletes an owned connection and reports success', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'connection-1' }] });
    await expect(deleteConnection({ query }, 'owner-1', 'connection-1')).resolves.toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toEqual(['connection-1', 'owner-1']);
  });

  it('a mismatched owner or missing connection deletes nothing and reports false', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(deleteConnection({ query }, 'attacker-owner-id', 'connection-1')).resolves.toBe(false);
  });
});

describe('replaceConnectionsForStructure -- app/apply-layout-mode.ts wipes and re-inserts the plan', () => {
  it('deletes every existing connection for the structure before inserting the new plan', async () => {
    const calls: [string, unknown[]?][] = [];
    const query = vi.fn(async (text: string, params?: unknown[]) => {
      calls.push([text, params]);
      return { rows: [] };
    });

    await replaceConnectionsForStructure({ query: query as unknown as Db['query'] }, 'structure-1', [
      { id: 'c1', cardIdA: 'card-1', cardIdB: 'card-2', directed: true },
      { id: 'c2', cardIdA: 'card-1', cardIdB: 'card-3', directed: true },
    ]);

    expect(calls[0][0]).toMatch(/DELETE FROM structure_connection/);
    expect(calls[0][1]).toEqual(['structure-1']);
    expect(calls).toHaveLength(3); // 1 DELETE + 2 INSERT
    expect(calls[1][0]).toMatch(/INSERT INTO structure_connection/);
  });

  it('an empty plan just deletes -- no INSERT calls follow', async () => {
    const calls: [string, unknown[]?][] = [];
    const query = vi.fn(async (text: string, params?: unknown[]) => {
      calls.push([text, params]);
      return { rows: [] };
    });

    await replaceConnectionsForStructure({ query: query as unknown as Db['query'] }, 'structure-1', []);

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/DELETE FROM structure_connection/);
  });
});
