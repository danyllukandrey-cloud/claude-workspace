// T42 -- App: developer-report use-case.
// RED (unit level, mocked Db + mocked EmailTransport): DoD (tracker.md T42)
// calls this an "integration test" -- real Postgres/.env is unavailable in
// this sandbox, so this documents the intended real-DB behaviour against a
// mocked Db, the same convention already used throughout plan/app/src/agent/
// (../infra/postgres-repo.test.ts) and plan/app/src/structure/
// (../../structure/app/close-card.test.ts): a fake `Db.query` (vi.fn),
// asserted by SQL text and params -- never a real Postgres connection here.
//
// DoD: "agent-detected error and user-requested report both persist a
// developer_report row and send the email; a failed send is marked
// delivery_status=failed, not silently dropped".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';
import type { EmailTransport } from '../infra/email-client';
import { fileAgentDetectedErrorReport, fileUserRequestedIssueReport } from './developer-report';
import type { DeveloperReportDeps } from './developer-report';

const DEVELOPER_EMAIL = 'dev@example.test';

function rawDeveloperReportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'report-1',
    user_id: 'user-1',
    trigger_type: 'agent_detected',
    description: 'Claude API timeout after 30s',
    delivery_status: 'sent',
    sent_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Підроблена база -- маршрутизує запит за текстом SQL, той самий підхід, що
 * ../infra/postgres-repo.test.ts і ../../structure/app/close-card.test.ts
 * уже застосовують.
 */
function fakeDb(insertedRow: ReturnType<typeof rawDeveloperReportRow>): { db: Db; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('INSERT INTO DEVELOPER_REPORT')) {
      return { rows: [insertedRow] };
    }
    if (upper.startsWith('UPDATE DEVELOPER_REPORT')) {
      return { rows: [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { db: { query: query as unknown as Db['query'] }, query };
}

function insertCalls(query: ReturnType<typeof vi.fn>) {
  return (query.mock.calls as [string, unknown[]?][]).filter(([text]) =>
    text.trim().toUpperCase().startsWith('INSERT INTO DEVELOPER_REPORT')
  );
}

function updateCalls(query: ReturnType<typeof vi.fn>) {
  return (query.mock.calls as [string, unknown[]?][]).filter(([text]) =>
    text.trim().toUpperCase().startsWith('UPDATE DEVELOPER_REPORT')
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fileAgentDetectedErrorReport -- AC-20', () => {
  it('persists a developer_report row (trigger_type agent_detected) and sends the email', async () => {
    const { db, query } = fakeDb(rawDeveloperReportRow());
    const transport: EmailTransport = vi.fn(async () => ({ messageId: 'provider-msg-1' }));
    const deps: DeveloperReportDeps = { db, transport, developerEmail: DEVELOPER_EMAIL };

    const report = await fileAgentDetectedErrorReport(deps, { errorSummary: 'Claude API timeout after 30s' });

    expect(insertCalls(query)).toHaveLength(1);
    const [, params] = insertCalls(query)[0];
    expect(params).toContain('agent_detected');
    expect(params).toContain('Claude API timeout after 30s');

    expect(transport).toHaveBeenCalledTimes(1);
    const sentEmail = (transport as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentEmail.to).toBe(DEVELOPER_EMAIL);
    expect(sentEmail.body).toContain('Claude API timeout after 30s');

    expect(report.triggerType).toBe('agent_detected');
    expect(report.deliveryStatus).toBe('sent');
    expect(updateCalls(query)).toHaveLength(0);
  });

  it('rejects an empty error summary as a thrown AppError, BEFORE any db write (domain sentinel mapped at the app boundary)', async () => {
    const { db, query } = fakeDb(rawDeveloperReportRow());
    const transport: EmailTransport = vi.fn(async () => ({ messageId: 'provider-msg-1' }));
    const deps: DeveloperReportDeps = { db, transport, developerEmail: DEVELOPER_EMAIL };

    await expect(fileAgentDetectedErrorReport(deps, { errorSummary: '   ' })).rejects.toBeInstanceOf(AppError);
    await expect(fileAgentDetectedErrorReport(deps, { errorSummary: '   ' })).rejects.toMatchObject({
      code: 'developer_report.description_required',
    });

    expect(query).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('fileUserRequestedIssueReport -- AC-20b', () => {
  it('persists a developer_report row (trigger_type user_requested, verbatim description) and sends the email, confirming delivery', async () => {
    const verbatim = 'я бачу таку-то штуку, відправ розробнику';
    const { db, query } = fakeDb(
      rawDeveloperReportRow({ id: 'report-2', trigger_type: 'user_requested', description: verbatim })
    );
    const transport: EmailTransport = vi.fn(async () => ({ messageId: 'provider-msg-2' }));
    const deps: DeveloperReportDeps = { db, transport, developerEmail: DEVELOPER_EMAIL };

    const report = await fileUserRequestedIssueReport(deps, { userId: 'user-1', userDescription: verbatim });

    const [, params] = insertCalls(query)[0];
    expect(params).toContain('user_requested');
    expect(params).toContain(verbatim);
    expect(params).toContain('user-1');

    expect(transport).toHaveBeenCalledTimes(1);
    expect(report.triggerType).toBe('user_requested');
    expect(report.description).toBe(verbatim);
    expect(report.deliveryStatus).toBe('sent');
  });
});

describe('a failed send is marked delivery_status=failed, not silently dropped (DoD)', () => {
  it('still persists the row (insert happens before the send is attempted), then updates delivery_status to failed when the transport rejects', async () => {
    const { db, query } = fakeDb(rawDeveloperReportRow());
    const failingTransport: EmailTransport = vi.fn(async () => {
      throw new Error('SMTP timeout -- симуляція недоступності провайдера');
    });
    const deps: DeveloperReportDeps = { db, transport: failingTransport, developerEmail: DEVELOPER_EMAIL };

    const report = await fileAgentDetectedErrorReport(deps, { errorSummary: 'boom' });

    // Row was persisted -- never silently dropped even though the send failed.
    expect(insertCalls(query)).toHaveLength(1);

    // The failure is recorded, not swallowed: an UPDATE marks it failed.
    const updates = updateCalls(query);
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toContain('report-1');

    // The function resolves (does not throw) with the TRUE final status, so a
    // caller can inspect it -- it never claims success when the send failed.
    expect(report.deliveryStatus).toBe('failed');
  });

  it('does the same for the user-requested path (AC-20b)', async () => {
    const { db, query } = fakeDb(rawDeveloperReportRow({ id: 'report-3', trigger_type: 'user_requested' }));
    const failingTransport: EmailTransport = vi.fn(async () => {
      throw new Error('provider rejected the message');
    });
    const deps: DeveloperReportDeps = { db, transport: failingTransport, developerEmail: DEVELOPER_EMAIL };

    const report = await fileUserRequestedIssueReport(deps, { userId: 'user-1', userDescription: 'boom' });

    expect(insertCalls(query)).toHaveLength(1);
    expect(updateCalls(query)).toHaveLength(1);
    expect(report.deliveryStatus).toBe('failed');
  });
});
