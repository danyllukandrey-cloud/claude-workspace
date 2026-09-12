// T23 -- Ports: GET /reports handler (AC-11, US-08).
// RED (unit level, mocked Db -- test-plan.md маркує AC-11 як integration
// (справжній Postgres); Docker/Neon недоступні в цьому середовищі, тож
// повноцінний integration-рівень лишається NON-red тут -- цей файл робить
// задачу TDD-водимою локально без реальної БД, той самий підхід, що
// ../../structure/ports/layout-handlers.test.ts і
// ../../cards/life-area-card/ports/card-handlers.test.ts (fake `Db.query`,
// маршрутизація за текстом SQL).
//
// Contract (contracts/openapi.yaml `/api/v1/reports` GET, operationId
// listReports): ReportPage (items + has_next + has_prev + next_cursor),
// query `periodType` (weekly|monthly|quarterly, опційно), `after` (uuid
// cursor) + `limit` (1..100, default 50). Report -- id/periodType/
// periodStart(date)/periodEnd(date)/content/status/generatedAt(date-time),
// data-model.md `activity_report`.
//
// Немає жодного репозиторного читання activity_report у постачений T13
// postgres-repo.ts (той файл документує себе явно: "THIS module's own 5
// tables only" -- proposal/rules/memory/chat/audit, НЕ activity_report,
// власність якої -- agent-worker, окремий контейнер §5 SAD). T15 (worker's
// write-side, schedule + report persistence) ще не реалізований (tracker.md:
// todo) і не є залежністю цієї задачі (tasks.json T23 deps: ["T13"] лише).
// Тому читання тут написане прямим SQL у reports-handler.ts, той самий
// патерн inline-`Db`/прямий query, що вже встановлений
// ../../agent-worker/infra/resource-writer.ts (T38) для таблиці, не покритої
// жодним репозиторієм.

import { describe, it, expect, vi } from 'vitest';
import { listReports } from './reports-handler';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';

function reportRow(
  overrides: Partial<{
    id: string;
    period_type: 'weekly' | 'monthly' | 'quarterly';
    period_start: Date;
    period_end: Date;
    content: string;
    status: 'generated' | 'dead_letter';
    generated_at: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'report-1',
    period_type: overrides.period_type ?? 'weekly',
    period_start: overrides.period_start ?? new Date('2026-09-01T00:00:00Z'),
    period_end: overrides.period_end ?? new Date('2026-09-07T00:00:00Z'),
    content: overrides.content ?? 'Тижневий звіт активності',
    status: overrides.status ?? 'generated',
    generated_at: overrides.generated_at ?? new Date('2026-09-08T09:00:00Z'),
  };
}

function fakeReportsDb(rows: ReturnType<typeof reportRow>[]): { db: Db; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('activity_report')) {
      expect(params).toContain(OWNER);
      return { rows };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { db: { query: query as unknown as Db['query'] }, query };
}

describe('listReports handler', () => {
  // Happy path -- контракт ReportPage, форма кожного елемента точно
  // components.schemas.Report (camelCase, periodStart/periodEnd -- date,
  // generatedAt -- date-time).
  it('returns every report as a ReportPage matching the contract shape', async () => {
    const { db } = fakeReportsDb([
      reportRow({ id: 'report-1' }),
      reportRow({ id: 'report-2', period_type: 'monthly', generated_at: new Date('2026-09-09T09:00:00Z') }),
    ]);

    const page = await listReports(db, OWNER, {});

    expect(page).toEqual({
      items: [
        {
          id: 'report-2',
          periodType: 'monthly',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
          content: 'Тижневий звіт активності',
          status: 'generated',
          generatedAt: '2026-09-09T09:00:00.000Z',
        },
        {
          id: 'report-1',
          periodType: 'weekly',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
          content: 'Тижневий звіт активності',
          status: 'generated',
          generatedAt: '2026-09-08T09:00:00.000Z',
        },
      ],
      has_next: false,
      has_prev: false,
      next_cursor: null,
    });
  });

  it('returns an empty ReportPage when the user has no reports yet', async () => {
    const { db } = fakeReportsDb([]);

    const page = await listReports(db, OWNER, {});

    expect(page).toEqual({ items: [], has_next: false, has_prev: false, next_cursor: null });
  });

  // Filterable by periodType (DoD) -- переданий фільтр іде в SQL, не
  // фільтрується постфактум у пам'яті.
  it('filters by periodType, passing it through to the SQL query', async () => {
    const { db, query } = fakeReportsDb([reportRow({ id: 'report-1', period_type: 'quarterly' })]);

    const page = await listReports(db, OWNER, { periodType: 'quarterly' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].periodType).toBe('quarterly');
    const [text, params] = query.mock.calls[0];
    expect(text).toContain('period_type');
    expect(params).toContain('quarterly');
  });

  it('does not add a period_type WHERE condition when periodType is omitted', async () => {
    const { db, query } = fakeReportsDb([reportRow()]);

    await listReports(db, OWNER, {});

    const [text, params] = query.mock.calls[0];
    expect(text).not.toContain('AND period_type');
    expect(params).toEqual([OWNER]);
  });

  // Cursor pagination (DoD "cursor-paginated") -- той самий підхід, що
  // ../../structure/ports/layout-handlers.ts's pagePositions: `after` --
  // id останнього запису попередньої сторінки, невалідний/прострочений
  // cursor падає на першу сторінку (не помилка).
  it('paginates with after/limit, reporting has_next/has_prev/next_cursor', async () => {
    const rows = [
      reportRow({ id: 'r-3', generated_at: new Date('2026-09-10T00:00:00Z') }),
      reportRow({ id: 'r-2', generated_at: new Date('2026-09-09T00:00:00Z') }),
      reportRow({ id: 'r-1', generated_at: new Date('2026-09-08T00:00:00Z') }),
    ];
    const { db } = fakeReportsDb(rows);

    const firstPage = await listReports(db, OWNER, { limit: 2 });
    expect(firstPage.items.map((r) => r.id)).toEqual(['r-3', 'r-2']);
    expect(firstPage.has_next).toBe(true);
    expect(firstPage.has_prev).toBe(false);
    expect(firstPage.next_cursor).toBe('r-2');

    const secondPage = await listReports(db, OWNER, { after: firstPage.next_cursor!, limit: 2 });
    expect(secondPage.items.map((r) => r.id)).toEqual(['r-1']);
    expect(secondPage.has_next).toBe(false);
    expect(secondPage.has_prev).toBe(true);
    expect(secondPage.next_cursor).toBeNull();
  });

  it('falls back to the first page when the cursor is not found', async () => {
    const { db } = fakeReportsDb([reportRow({ id: 'r-1' })]);

    const page = await listReports(db, OWNER, { after: 'gone-missing' });

    expect(page.items.map((r) => r.id)).toEqual(['r-1']);
    expect(page.has_prev).toBe(false);
  });

  it('clamps limit into [1, 100], default 50', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => reportRow({ id: `r-${i}` }));
    const { db } = fakeReportsDb(rows);

    const zeroLimit = await listReports(db, OWNER, { limit: 0 });
    expect(zeroLimit.items).toHaveLength(1);

    const overLimit = await listReports(db, OWNER, { limit: 1000 });
    expect(overLimit.items).toHaveLength(5);
  });
});
