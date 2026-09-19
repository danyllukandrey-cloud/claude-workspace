// Ports: GET /action-log handler ("Лог дій"). Той самий cursor-пагінаційний
// шаблон, що ../ports/reports-handler.ts -- тут `db.query` мокується напряму
// (action-log-repo.ts, на відміну від activity-report-repo.ts, лишається
// частиною цього модуля, не окремого контейнера).

import { describe, it, expect, vi } from 'vitest';
import { listActionLog } from './action-log-handler';
import type { Db } from '../infra/action-log-repo';

const OWNER = 'owner-1';

function row(overrides: Partial<{ id: string; action: string; occurred_at: Date }> = {}) {
  return {
    id: overrides.id ?? 'log-1',
    owner_user_id: OWNER,
    action: overrides.action ?? 'Створено картку «Спорт»',
    occurred_at: overrides.occurred_at ?? new Date('2026-09-15T10:00:00Z'),
  };
}

describe('listActionLog', () => {
  it('returns items newest-first, mapped to camelCase DTO', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        row({ id: 'log-2', action: 'Заархівовано картку «Читання»', occurred_at: new Date('2026-09-15T11:00:00Z') }),
        row({ id: 'log-1', action: 'Створено картку «Спорт»', occurred_at: new Date('2026-09-15T10:00:00Z') }),
      ],
    });
    const db: Db = { query };

    const page = await listActionLog(db, OWNER);

    expect(page.items).toEqual([
      { id: 'log-2', action: 'Заархівовано картку «Читання»', occurredAt: '2026-09-15T11:00:00.000Z' },
      { id: 'log-1', action: 'Створено картку «Спорт»', occurredAt: '2026-09-15T10:00:00.000Z' },
    ]);
    expect(page.has_next).toBe(false);
    expect(page.has_prev).toBe(false);
    expect(query.mock.calls[0][1]).toEqual([OWNER]);
  });

  it('returns an empty page when the owner has no logged actions yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const page = await listActionLog(db, OWNER);

    expect(page).toEqual({ items: [], has_next: false, has_prev: false, next_cursor: null });
  });

  it('paginates with after/limit, an unknown cursor falling back to the first page', async () => {
    const rows = [
      row({ id: 'log-3', occurred_at: new Date('2026-09-15T12:00:00Z') }),
      row({ id: 'log-2', occurred_at: new Date('2026-09-15T11:00:00Z') }),
      row({ id: 'log-1', occurred_at: new Date('2026-09-15T10:00:00Z') }),
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const db: Db = { query };

    const firstPage = await listActionLog(db, OWNER, { limit: 2 });
    expect(firstPage.items.map((item) => item.id)).toEqual(['log-3', 'log-2']);
    expect(firstPage.has_next).toBe(true);
    expect(firstPage.next_cursor).toBe('log-2');

    const nextPage = await listActionLog(db, OWNER, { after: 'log-2', limit: 2 });
    expect(nextPage.items.map((item) => item.id)).toEqual(['log-1']);
    expect(nextPage.has_next).toBe(false);

    const unknownCursorPage = await listActionLog(db, OWNER, { after: 'does-not-exist', limit: 2 });
    expect(unknownCursorPage.items.map((item) => item.id)).toEqual(['log-3', 'log-2']);
  });
});
