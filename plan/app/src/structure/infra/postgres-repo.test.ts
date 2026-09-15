// T9 -- Infra: backend repository for structure + layout positions.
// RED (unit level, mocked Db): AC-03/AC-08/AC-09/AC-12/AC-16.
//
// Real DB round-trip (AC-03/08/09/12/16 as chosen by test-plan.md, "integration")
// is exercised against the shared Postgres already wired for this module's
// other integration coverage ("T10 -- Postgres repo (life-area-card)" /
// "structure T1/T2/T26" sections of migrations.integration.test.ts) -- out of
// scope for this task's files_hint (postgres-repo.ts only), left for the
// integration-level extension of that shared suite.
//
// Same mocking convention as
// ../../cards/life-area-card/infra/postgres-repo.test.ts: fake `Db.query`
// (vi.fn), assert both the SQL text (owner_user_id scoping) and the mapped
// return shape (camelCase). Вимоги 14/15: layout_mode -- ОДНЕ плоске поле
// (5 значень), logic_variant прибраний.

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './postgres-repo';
import {
  findStructureByOwner,
  insertStructure,
  updateStructure,
  insertLayoutPosition,
  listActiveLayoutPositionsByOwner,
  updateLayoutPositionCell,
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
    cell_index: 3,
    status: 'active',
    position_updated_at: new Date('2026-01-03T00:00:00Z'),
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
    // A real WHERE owner_user_id = $1 for a different owner matches nothing;
    // the fake DB reproduces that by returning no rows.
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
      cellIndex: 3,
    });
    expect(inserted).toEqual({
      id: 'position-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      cellIndex: 3,
      status: 'active',
      positionUpdatedAt: new Date('2026-01-03T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const listQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow()] });
    const dbForList: Db = { query: listQuery };

    const positions = await listActiveLayoutPositionsByOwner(dbForList, 'owner-1');
    expect(positions).toHaveLength(1);
    expect(positions[0].cellIndex).toBe(3);

    // Owner scoping happens via a join back to structure.owner_user_id --
    // the query text must mention owner_user_id even though the column lives
    // on `structure`, not `structure_layout_position` (data-model.md).
    const [listSql, listParams] = listQuery.mock.calls[0];
    expect(listSql).toMatch(/owner_user_id/);
    expect(listParams).toEqual(['owner-1']);
  });

  // ISS-101/D-117: авто-розкладена позиція (нова картка) пишеться зі свідомо
  // старим position_updated_at (епоха, 1970), не з дефолту now() колонки --
  // інакше перше ж реальне переміщення користувача могло тихо програти через
  // розбіжність годинників клієнт/БД (виміряно ~54мс проти dev Neon).
  it('writes a sentinel (epoch) position_updated_at instead of relying on the column default now()', async () => {
    const insertQuery = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow()] });
    const db: Db = { query: insertQuery };

    await insertLayoutPosition(db, { id: 'position-1', structureId: 'structure-1', cardId: 'card-1', cellIndex: 3 });

    const [sql, params] = insertQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/position_updated_at/);
    expect(params).toEqual(['position-1', 'structure-1', 'card-1', 3, new Date(0)]);
  });

  it('a card with no active position at all is simply absent from the list -- AC-09 places no forced placeholder row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(listActiveLayoutPositionsByOwner(db, 'owner-1')).resolves.toEqual([]);
  });
});

describe('updateLayoutPositionCell -- AC-08 drag-and-drop save, scoped by owner (AC-03)', () => {
  it('moves the card to the new cell and returns it when the position belongs to the given owner', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawLayoutPositionRow({ cell_index: 9 })],
    });
    const db: Db = { query };

    const moved = await updateLayoutPositionCell(db, 'owner-1', 'card-1', 9, '2026-01-04T00:00:00Z');

    expect(moved?.cellIndex).toBe(9);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toContain('owner-1');
  });

  // Рев'ю 2026-09-11 (AC-11b/AC-16b/AC-17 + міграція 06): "картка без клітинки"
  // мусить доїхати до БД справжнім SQL NULL. 0 -- це перша РЕАЛЬНА клітинка, а
  // рядок 'null' Postgres поклав би в INTEGER-колонку як помилку типу.
  it('binds cell_index as a real SQL NULL when the card is reset to "no cell"', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawLayoutPositionRow({ cell_index: null })] });
    const db: Db = { query };

    await updateLayoutPositionCell(db, 'owner-1', 'card-1', null, '2026-01-04T00:00:00Z');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/cell_index\s*=\s*\$\d/);
    expect(params[0]).toBeNull();
    // Жодного числа серед параметрів -- саме числом (baseOrder) і протікала
    // "клітинка" замість її відсутності.
    expect((params as unknown[]).filter((value) => typeof value === 'number')).toEqual([]);
    expect(params).not.toContain('null');
  });

  it('a mismatched owner_user_id never moves nor discloses another owner\'s card position (AC-03)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      updateLayoutPositionCell(db, 'attacker-owner-id', 'card-1', 9, '2026-01-04T00:00:00Z')
    ).resolves.toBeNull();
  });
});
