// T23 -- Ports: GET /reports handler (AC-11, US-08).
// RED (unit level): test-plan.md маркує AC-11 як integration (справжній
// Postgres); Docker/Neon недоступні в цьому середовищі, тож повноцінний
// integration-рівень лишається NON-red тут -- цей файл робить задачу
// TDD-водимою локально без реальної БД.
//
// Contract (contracts/openapi.yaml `/api/v1/reports` GET, operationId
// listReports): ReportPage (items + has_next + has_prev + next_cursor),
// query `periodType` (weekly|monthly|quarterly, опційно), `after` (uuid
// cursor) + `limit` (1..100, default 20). Report -- id/periodType/
// periodStart(date)/periodEnd(date)/content/status/generatedAt(date-time),
// data-model.md `activity_report`.
//
// Review 2026-09-12 (ADR-0005, "ports не володіє SQL"): цей handler більше не
// пише SQL сам -- запит живе в
// ../../agent-worker/infra/activity-report-repo.ts (`activity_report`
// належить agent-worker, окремий контейнер §5 SAD). Тому тест мокає саму
// функцію репозиторію (`findActivityReportsByUser`), а не текст SQL, який
// раніше йшов через мокований `Db.query` -- цей файл більше не знає, яким
// SQL-запитом репозиторій отримує рядки.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../infra/postgres-repo';

const findActivityReportsByUser = vi.fn();

vi.mock('../../agent-worker/infra/activity-report-repo', () => ({
  findActivityReportsByUser: (...args: unknown[]) => findActivityReportsByUser(...args),
}));

const { listReports } = await import('./reports-handler');

const OWNER = 'owner-1';

// db сам ніколи не викликається напряму цим handler-ом більше -- лише
// прокидається в замокану функцію репозиторію; стаб достатній, щоб
// задовольнити тип `Db`.
const db: Db = { query: vi.fn() };

function reportRecord(
  overrides: Partial<{
    id: string;
    periodType: 'weekly' | 'monthly' | 'quarterly';
    periodStart: Date;
    periodEnd: Date;
    content: string;
    status: 'generated' | 'dead_letter';
    generatedAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'report-1',
    periodType: overrides.periodType ?? ('weekly' as const),
    periodStart: overrides.periodStart ?? new Date('2026-09-01T00:00:00Z'),
    periodEnd: overrides.periodEnd ?? new Date('2026-09-07T00:00:00Z'),
    content: overrides.content ?? 'Тижневий звіт активності',
    status: overrides.status ?? ('generated' as const),
    generatedAt: overrides.generatedAt ?? new Date('2026-09-08T09:00:00Z'),
  };
}

beforeEach(() => {
  findActivityReportsByUser.mockReset();
});

describe('listReports handler', () => {
  // Happy path -- контракт ReportPage, форма кожного елемента точно
  // components.schemas.Report (camelCase, periodStart/periodEnd -- date,
  // generatedAt -- date-time).
  it('returns every report as a ReportPage matching the contract shape', async () => {
    findActivityReportsByUser.mockResolvedValue([
      reportRecord({ id: 'report-1' }),
      reportRecord({ id: 'report-2', periodType: 'monthly', generatedAt: new Date('2026-09-09T09:00:00Z') }),
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
    findActivityReportsByUser.mockResolvedValue([]);

    const page = await listReports(db, OWNER, {});

    expect(page).toEqual({ items: [], has_next: false, has_prev: false, next_cursor: null });
  });

  // Filterable by periodType (DoD) -- переданий фільтр іде в репозиторій, не
  // фільтрується постфактум у пам'яті цим handler-ом.
  it('passes periodType through to the repository', async () => {
    findActivityReportsByUser.mockResolvedValue([reportRecord({ id: 'report-1', periodType: 'quarterly' })]);

    const page = await listReports(db, OWNER, { periodType: 'quarterly' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].periodType).toBe('quarterly');
    expect(findActivityReportsByUser).toHaveBeenCalledWith(db, OWNER, 'quarterly');
  });

  it('passes undefined periodType through to the repository when omitted', async () => {
    findActivityReportsByUser.mockResolvedValue([reportRecord()]);

    await listReports(db, OWNER, {});

    expect(findActivityReportsByUser).toHaveBeenCalledWith(db, OWNER, undefined);
  });

  // Cursor pagination (DoD "cursor-paginated") -- той самий підхід, що
  // ../../structure/ports/layout-handlers.ts's pagePositions: `after` --
  // id останнього запису попередньої сторінки, невалідний/прострочений
  // cursor падає на першу сторінку (не помилка).
  it('paginates with after/limit, reporting has_next/has_prev/next_cursor', async () => {
    findActivityReportsByUser.mockResolvedValue([
      reportRecord({ id: 'r-3', generatedAt: new Date('2026-09-10T00:00:00Z') }),
      reportRecord({ id: 'r-2', generatedAt: new Date('2026-09-09T00:00:00Z') }),
      reportRecord({ id: 'r-1', generatedAt: new Date('2026-09-08T00:00:00Z') }),
    ]);

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
    findActivityReportsByUser.mockResolvedValue([reportRecord({ id: 'r-1' })]);

    const page = await listReports(db, OWNER, { after: 'gone-missing' });

    expect(page.items.map((r) => r.id)).toEqual(['r-1']);
    expect(page.has_prev).toBe(false);
  });

  // Review 2026-09-12: DEFAULT_LIMIT fixed 50 -> 20 -- openapi.yaml GET
  // /reports `limit.default` документує 20, не 50.
  it('clamps limit into [1, 100], default 20', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => reportRecord({ id: `r-${i}` }));
    findActivityReportsByUser.mockResolvedValue(rows);

    const zeroLimit = await listReports(db, OWNER, { limit: 0 });
    expect(zeroLimit.items).toHaveLength(1);

    const overLimit = await listReports(db, OWNER, { limit: 1000 });
    expect(overLimit.items).toHaveLength(25);

    const defaultLimit = await listReports(db, OWNER, {});
    expect(defaultLimit.items).toHaveLength(20);
  });
});
