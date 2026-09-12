// T41 -- App (agent-worker): daily-sync use-case.
// RED (unit level, mocked Db -- same convention as ../../structure/app/close-card.test.ts
// and ../infra/resource-writer.test.ts): AC-18/AC-18b. Docker/Neon недоступні в цьому
// середовищі (task instructions), тож цей файл документує намічену поведінку проти
// РЕАЛЬНОЇ схеми (sync_resource/card/entry/structure/agent_audit_event) з підробленим
// `db.query`, а не проти живого Postgres -- той самий підхід, що вже
// resource-writer.test.ts і close-card.test.ts застосовують для своїх модулів.
//
// Жоден із postgres-repo.ts модулів (life-area-card/structure) і сам
// resource-writer.ts НЕ мокаються -- лише межа `db.query` (як
// update-structure.test.ts/close-card.test.ts), тож цей тест реально прогонює
// SQL-тексти обох сусідніх фіч через фальшиву базу -- звідси "інтеграційний" у
// DoD T41, попри відсутність живого з'єднання.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../infra/resource-writer';
import { runDailySync } from './daily-sync';

const USER_DUE = 'user-due-1';
const USER_NOT_DUE = 'user-not-due-1';
const RESOURCE_DUE_ID = 'resource-due-1';
const RESOURCE_NOT_DUE_ID = 'resource-not-due-1';
const CARD_ID = 'card-1';
const NOW = new Date('2026-09-12T10:00:00.000Z');

function syncResourceRow(opts: {
  id: string;
  userId: string;
  url: string;
  status?: 'active' | 'error';
  lastSyncedAt?: Date | null;
}) {
  return {
    id: opts.id,
    user_id: opts.userId,
    url: opts.url,
    status: opts.status ?? 'active',
    last_synced_at: opts.lastSyncedAt ?? null,
  };
}

function cardRow() {
  return {
    id: CARD_ID,
    owner_user_id: USER_DUE,
    name: 'Спорт',
    description: null,
    status: 'active' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function entryRow() {
  return {
    id: 'entry-1',
    metric_block_id: 'metric-block-1',
    card_id: CARD_ID,
    amount: 5,
    raw_text: '5 км',
    status: 'confirmed' as const,
    source_device_id: null,
    recorded_at: new Date('2026-09-11T08:00:00Z'),
    confirmed_at: new Date('2026-09-11T08:01:00Z'),
    created_at: new Date('2026-09-11T08:00:00Z'),
  };
}

function structureRow(ownerUserId: string) {
  return {
    id: 'structure-1',
    owner_user_id: ownerUserId,
    declaration: 'Моя декларація Структури',
    layout_mode: 'free' as const,
    logic_variant: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує запит за текстом SQL, той самий підхід, що
 * ../../structure/app/close-card.test.ts вже застосовує.
 */
function fakeDb(opts: {
  resources: ReturnType<typeof syncResourceRow>[];
  writeOutcome: 'success' | 'failure';
}): { db: Db; writeToResource: ReturnType<typeof vi.fn> } {
  const writeToResource = vi.fn(async () => {
    if (opts.writeOutcome === 'failure') {
      throw Object.assign(new Error('Google API: permission denied'), { status: 403 });
    }
  });

  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const upper = text.trim().toUpperCase();

    if (upper.startsWith('SELECT') && text.includes('FROM sync_resource')) {
      return { rows: opts.resources };
    }
    if (upper.startsWith('SELECT') && text.includes('FROM card')) {
      const ownerUserId = params?.[0];
      return { rows: ownerUserId === USER_DUE ? [cardRow()] : [] };
    }
    if (upper.startsWith('SELECT') && text.includes('FROM entry')) {
      const cardId = params?.[0];
      return { rows: cardId === CARD_ID ? [entryRow()] : [] };
    }
    if (upper.startsWith('SELECT') && text.includes('FROM structure WHERE')) {
      const ownerUserId = params?.[0];
      return { rows: ownerUserId === USER_DUE ? [structureRow(USER_DUE)] : [] };
    }
    if (upper.startsWith('UPDATE') && text.includes('sync_resource')) {
      return { rows: [] };
    }
    if (upper.startsWith('INSERT') && text.includes('agent_audit_event')) {
      return { rows: [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });

  return { db: { query: query as unknown as Db['query'] }, writeToResource };
}

function queryCalls(db: Db) {
  return (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
}

function auditCalls(db: Db) {
  return queryCalls(db).filter(([text]) => text.includes('agent_audit_event') && text.trim().toUpperCase().startsWith('INSERT'));
}

function resourceUpdateCalls(db: Db) {
  return queryCalls(db).filter(([text]) => text.trim().toUpperCase().startsWith('UPDATE') && text.includes('sync_resource'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runDailySync -- AC-18 happy path', () => {
  it('writes a fresh copy of the user cards/entries/declarations to each due active resource', async () => {
    const due = syncResourceRow({ id: RESOURCE_DUE_ID, userId: USER_DUE, url: 'https://docs.example.test/due', lastSyncedAt: null });
    const { db, writeToResource } = fakeDb({ resources: [due], writeOutcome: 'success' });

    const outcomes = await runDailySync(db, writeToResource, NOW);

    expect(writeToResource).toHaveBeenCalledTimes(1);
    const [url, content] = writeToResource.mock.calls[0];
    expect(url).toBe('https://docs.example.test/due');
    expect(content).toContain('Спорт'); // назва картки
    expect(content).toContain('Моя декларація Структури'); // декларація Структури
    expect(content).toMatch(/"amount":\s*5/); // запис

    expect(outcomes).toEqual([{ resourceId: RESOURCE_DUE_ID, userId: USER_DUE, ok: true }]);

    // Успіх -- жодного audit-рядка (це шлях помилки, AC-18b).
    expect(auditCalls(db)).toHaveLength(0);
  });

  it('skips a resource already synced earlier today -- not due, no write attempted (AC-18b, "не намагається мовчки повторювати нескінченно")', async () => {
    const notDue = syncResourceRow({
      id: RESOURCE_NOT_DUE_ID,
      userId: USER_NOT_DUE,
      url: 'https://docs.example.test/not-due',
      lastSyncedAt: new Date('2026-09-12T02:00:00.000Z'), // той самий календарний день (UTC), що NOW
    });
    const { db, writeToResource } = fakeDb({ resources: [notDue], writeOutcome: 'success' });

    const outcomes = await runDailySync(db, writeToResource, NOW);

    expect(writeToResource).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(auditCalls(db)).toHaveLength(0);
  });
});

describe('runDailySync -- AC-18b access error', () => {
  it('a write failure leaves the typed error to resource-writer (status=error + last_error) and records resource_sync_failed to agent_audit_event', async () => {
    const due = syncResourceRow({ id: RESOURCE_DUE_ID, userId: USER_DUE, url: 'https://docs.example.test/due', lastSyncedAt: null });
    const { db, writeToResource } = fakeDb({ resources: [due], writeOutcome: 'failure' });

    const outcomes = await runDailySync(db, writeToResource, NOW);

    expect(writeToResource).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ resourceId: RESOURCE_DUE_ID, userId: USER_DUE, ok: false }]);

    // resource-writer.ts (T38) уже сам виставляє status='error'/last_error -- тут
    // лише перевіряємо, що це реально відбулось у цьому наскрізному прогоні.
    const updates = resourceUpdateCalls(db);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toMatch(/status/);
    expect(updates[0][0]).toMatch(/last_error/);
    expect(updates[0][1]).toContain(RESOURCE_DUE_ID);

    // AC-18b: подія в agent_audit_event, а не мовчазний ретрай.
    const audits = auditCalls(db);
    expect(audits).toHaveLength(1);
    const [auditSql, auditParams] = audits[0];
    expect(auditSql).toMatch(/resource_sync_failed/);
    expect(auditSql).toMatch(/sync_resource/);
    expect(auditParams).toContain(USER_DUE);
    expect(auditParams).toContain(RESOURCE_DUE_ID);
  });

  it('never retries within the same run -- exactly one write attempt per due resource, even on failure', async () => {
    const due = syncResourceRow({ id: RESOURCE_DUE_ID, userId: USER_DUE, url: 'https://docs.example.test/due', lastSyncedAt: null });
    const { db, writeToResource } = fakeDb({ resources: [due], writeOutcome: 'failure' });

    await runDailySync(db, writeToResource, NOW);

    expect(writeToResource).toHaveBeenCalledTimes(1);
  });
});
