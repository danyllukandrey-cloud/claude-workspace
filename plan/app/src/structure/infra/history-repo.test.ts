// T10 -- Infra: history repository (write + asOf read).
// RED (unit level, mocked Db): AC-07 (gap trend needs history-log reads over
// time), AC-15 (rename/move recorded as a timestamped structure_history_event,
// same mechanism as AC-12's closure event).
//
// Real DB round-trip (DoD: "repository writes an event and later reads it back
// via an asOf query against the same backend database") is exercised in
// ../../../history-repo.integration.test.ts (project root, same convention as
// migrations.integration.test.ts -- real Neon, npm run test:integration).
// Docker/Neon network access is unavailable in this sandbox, so that suite is
// expected NON-red here; this file is the one that must be GOOD red locally.
//
// Same mocking convention as ./postgres-repo.test.ts and
// ../../cards/life-area-card/infra/postgres-repo.test.ts: fake `Db.query`
// (vi.fn), assert both the SQL text and the mapped return shape (camelCase).

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './postgres-repo';
import { insertHistoryEvent, findHistoryEventsAsOf } from './history-repo';

function rawHistoryEventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-1',
    structure_id: 'structure-1',
    card_id: 'card-1',
    event_type: 'moved',
    detail: 'cell_index -> 5',
    occurred_at: new Date('2026-01-10T00:00:00Z'),
    ...overrides,
  };
}

describe('insertHistoryEvent -- AC-15 (rename/move recorded as a timestamped event, same mechanism as AC-12 closure)', () => {
  it('writes structure_id/card_id/event_type/detail and returns the camelCase record with a timestamp', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rawHistoryEventRow()] });
    const db: Db = { query };

    const written = await insertHistoryEvent(db, {
      id: 'event-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      eventType: 'moved',
      detail: 'cell_index -> 5',
    });

    expect(written).toEqual({
      id: 'event-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      eventType: 'moved',
      detail: 'cell_index -> 5',
      occurredAt: new Date('2026-01-10T00:00:00Z'),
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/structure_history_event/);
    expect(sql).toMatch(/event_type/);
    expect(params).toEqual(['event-1', 'structure-1', 'card-1', 'moved', 'cell_index -> 5']);
  });

  it('accepts the "renamed" event type -- AC-15 covers rename, not only move/close', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [rawHistoryEventRow({ event_type: 'renamed', detail: 'старе -> нове' })],
    });
    const db: Db = { query };

    const written = await insertHistoryEvent(db, {
      id: 'event-1',
      structureId: 'structure-1',
      cardId: 'card-1',
      eventType: 'renamed',
      detail: 'старе -> нове',
    });

    expect(written.eventType).toBe('renamed');
  });
});

describe('findHistoryEventsAsOf -- AC-07 (gap trend over time reads the history log as of a point in time)', () => {
  it('queries by structure_id, filters occurred_at <= asOf, and maps rows to camelCase', async () => {
    const asOf = new Date('2026-01-15T00:00:00Z');
    const query = vi.fn().mockResolvedValue({
      rows: [
        rawHistoryEventRow({ id: 'event-1', occurred_at: new Date('2026-01-10T00:00:00Z') }),
        rawHistoryEventRow({ id: 'event-2', card_id: 'card-2', occurred_at: new Date('2026-01-12T00:00:00Z') }),
      ],
    });
    const db: Db = { query };

    const events = await findHistoryEventsAsOf(db, 'structure-1', asOf);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: 'event-1', cardId: 'card-1' });
    expect(events[1]).toMatchObject({ id: 'event-2', cardId: 'card-2' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/structure_id/);
    expect(sql).toMatch(/occurred_at\s*<=/);
    expect(params).toEqual(['structure-1', asOf]);
  });

  it('a point in time before any event existed reads back no history -- not an error, an empty trend', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      findHistoryEventsAsOf(db, 'structure-1', new Date('2020-01-01T00:00:00Z'))
    ).resolves.toEqual([]);
  });
});
