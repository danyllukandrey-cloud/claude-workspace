// App: applyLayoutMode use-case -- computes and persists the auto-layout for
// a newly chosen layoutMode (D-131-наступне рішення, Андрій у чаті,
// 2026-09-15: "Кожен з варіантів конфігурації потрібно просто розташувати
// за логікою і все без якихось законів з клітинками").
//
// Той самий fake-Db-за-текстом-SQL стиль, що ./move-card.test.ts. Формули
// самих розкладів уже покриті ../domain/layout.test.ts -- тут перевіряємо
// лише ОРКЕСТРАЦІЮ: які записи йдуть у БД, у якому обсязі, і що 'staging'/
// null справді нічого не пишуть.

import { describe, it, expect, vi } from 'vitest';
import { applyLayoutMode } from './apply-layout-mode';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function positionRow(cardId: string, createdAt: string) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    position_x: null,
    position_y: null,
    status: 'active' as const,
    position_updated_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date(createdAt),
  };
}

function fakeDb(activePositions: ReturnType<typeof positionRow>[]): { db: Db; calls: [string, unknown[]?][] } {
  const calls: [string, unknown[]?][] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push([text, params]);
    const sql = text.trim().toUpperCase();
    if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
      return { rows: activePositions };
    }
    if (text.includes('structure_layout_position') && sql.startsWith('UPDATE')) {
      return { rows: [] };
    }
    if (text.includes('structure_connection')) {
      return { rows: [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { db: { query: query as unknown as Db['query'] }, calls };
}

describe('applyLayoutMode -- "staging" and "null" are true no-ops', () => {
  it('writes nothing at all for "staging", not even a read', async () => {
    const { db, calls } = fakeDb([positionRow('c1', '2026-01-01T00:00:00Z')]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'staging' });

    expect(calls).toHaveLength(0);
  });

  it('writes nothing for layoutMode: null either', async () => {
    const { db, calls } = fakeDb([positionRow('c1', '2026-01-01T00:00:00Z')]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: null });

    expect(calls).toHaveLength(0);
  });
});

describe('applyLayoutMode -- no active cards means nothing to arrange', () => {
  it('reads positions, finds none, and stops without any write', async () => {
    const { db, calls } = fakeDb([]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'free' });

    const writes = calls.filter(([text]) => /^(UPDATE|INSERT|DELETE)/i.test(text.trim()));
    expect(writes).toHaveLength(0);
  });
});

describe('applyLayoutMode -- a real mode writes a position for every active card', () => {
  it('updates x/y for every card returned by listActiveLayoutPositionsByOwner ("free")', async () => {
    const { db, calls } = fakeDb([
      positionRow('c1', '2026-01-01T00:00:00Z'),
      positionRow('c2', '2026-01-02T00:00:00Z'),
      positionRow('c3', '2026-01-03T00:00:00Z'),
    ]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'free' });

    const positionUpdates = calls.filter(
      ([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE'),
    );
    expect(positionUpdates).toHaveLength(3);
    const touchedCardIds = new Set(positionUpdates.map(([, params]) => (params as unknown[])[3]));
    expect(touchedCardIds).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('replaces connections for the structure even for "free" (which produces none -- a deliberate wipe)', async () => {
    const { db, calls } = fakeDb([positionRow('c1', '2026-01-01T00:00:00Z'), positionRow('c2', '2026-01-02T00:00:00Z')]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'free' });

    const connectionDeletes = calls.filter(([text]) => text.includes('DELETE FROM structure_connection'));
    expect(connectionDeletes).toHaveLength(1);
    expect(connectionDeletes[0][1]).toEqual([STRUCTURE_ID]);
    const connectionInserts = calls.filter(([text]) => text.includes('INSERT INTO structure_connection'));
    expect(connectionInserts).toHaveLength(0); // free -- нуль зв'язків
  });

  it('writes real connections for "focus" (every surrounding card links to the centre)', async () => {
    const { db, calls } = fakeDb([
      positionRow('center', '2026-01-01T00:00:00Z'),
      positionRow('c2', '2026-01-02T00:00:00Z'),
      positionRow('c3', '2026-01-03T00:00:00Z'),
    ]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'focus' });

    const connectionInserts = calls.filter(([text]) => text.includes('INSERT INTO structure_connection'));
    expect(connectionInserts).toHaveLength(2);
  });

  it('writes directed connections for "cause_effect"', async () => {
    const { db, calls } = fakeDb([
      positionRow('root', '2026-01-01T00:00:00Z'),
      positionRow('c2', '2026-01-02T00:00:00Z'),
      positionRow('c3', '2026-01-03T00:00:00Z'),
    ]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'cause_effect' });

    const connectionInserts = calls.filter(([text]) => text.includes('INSERT INTO structure_connection'));
    expect(connectionInserts).toHaveLength(2);
    for (const [, params] of connectionInserts) {
      expect((params as unknown[])[4]).toBe(true); // directed
    }
  });

  it('uses one shared timestamp for every position write -- one user action, not N (LWW, ADR-0002)', async () => {
    const { db, calls } = fakeDb([positionRow('c1', '2026-01-01T00:00:00Z'), positionRow('c2', '2026-01-02T00:00:00Z')]);

    await applyLayoutMode(db, { ownerUserId: OWNER, structureId: STRUCTURE_ID, layoutMode: 'free' });

    const positionUpdates = calls.filter(
      ([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE'),
    );
    const timestamps = positionUpdates.map(([, params]) => (params as unknown[])[2]);
    expect(new Set(timestamps.map((t) => String(t))).size).toBe(1);
  });
});
