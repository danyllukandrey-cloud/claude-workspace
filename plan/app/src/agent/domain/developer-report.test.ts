import { describe, it, expect } from 'vitest';
import { reportAgentDetectedError, reportUserRequestedIssue } from './developer-report';
import type { DeveloperReport } from './developer-report';

/** Розпаковує `Result<DeveloperReport, DeveloperReportError>` для happy-path тестів. */
function unwrap(
  result: ReturnType<typeof reportAgentDetectedError> | ReturnType<typeof reportUserRequestedIssue>,
): DeveloperReport {
  if (!result.ok) {
    throw new Error(`очікувалось ok, отримано err: ${result.error.code}`);
  }
  return result.value;
}

// AC-20 (US-14, agent-initiated): агент сам виявив технічну помилку -- звіт
// формується БЕЗ участі користувача, тому вхід не містить і не потребує
// жодного тексту від користувача (тип AgentDetectedErrorInput не має поля
// userDescription взагалі -- перевіряємо і рантайм-поведінку, не лише типи).
describe('reportAgentDetectedError -- AC-20', () => {
  it('produces a valid developer_report payload from only the agent\'s own error text, no user text required', () => {
    const report = unwrap(
      reportAgentDetectedError({
        id: 'report-1',
        errorSummary: 'Claude API timeout after 30s',
      }),
    );

    expect(report.triggerType).toBe('agent_detected');
    expect(report.description).toContain('Claude API timeout after 30s');
    expect(report.deliveryStatus).toBe('sent');
    expect(report.id).toBe('report-1');
  });

  it('defaults userId to null when the error was not tied to a specific user session', () => {
    const report = unwrap(reportAgentDetectedError({ id: 'report-2', errorSummary: 'Unhandled DB error' }));
    expect(report.userId).toBeNull();
  });

  it('carries the userId through when the agent-detected error DID occur within a user session', () => {
    const report = unwrap(
      reportAgentDetectedError({
        id: 'report-3',
        userId: 'user-1',
        errorSummary: 'Claude API 500',
      }),
    );
    expect(report.userId).toBe('user-1');
  });

  it('folds optional context into the description alongside the error summary', () => {
    const report = unwrap(
      reportAgentDetectedError({
        id: 'report-4',
        errorSummary: 'Claude API timeout',
        context: 'trying to classify a photo attachment',
      }),
    );
    expect(report.description).toContain('Claude API timeout');
    expect(report.description).toContain('trying to classify a photo attachment');
  });

  it('rejects an empty/whitespace-only error summary (ADR-0006 sentinel, not a throw) -- description is NOT NULL in the schema', () => {
    const result = reportAgentDetectedError({ id: 'report-5', errorSummary: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('developer_report.description_required');
  });
});

// AC-20b (US-14, user-initiated): користувач сам просить переслати проблему
// -- звіт формується з ЙОГО опису, дослівно, без переписування агентом.
describe('reportUserRequestedIssue -- AC-20b', () => {
  it('produces a valid developer_report payload that preserves the user\'s description verbatim', () => {
    const verbatim = 'я бачу таку-то штуку, відправ розробнику -- ось скріншот опису';
    const report = unwrap(reportUserRequestedIssue({ id: 'report-6', userId: 'user-1', userDescription: verbatim }));

    expect(report.triggerType).toBe('user_requested');
    expect(report.description).toBe(verbatim);
    expect(report.deliveryStatus).toBe('sent');
    expect(report.userId).toBe('user-1');
  });

  it('does not trim or otherwise rewrite the user\'s wording', () => {
    const withSpacing = '  два  пробіли  всередині  ';
    const report = unwrap(reportUserRequestedIssue({ id: 'report-7', userId: 'user-1', userDescription: withSpacing }));
    expect(report.description).toBe(withSpacing);
  });

  it('rejects an empty/whitespace-only user description (ADR-0006 sentinel, not a throw) -- description is NOT NULL in the schema', () => {
    const result = reportUserRequestedIssue({ id: 'report-8', userId: 'user-1', userDescription: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('developer_report.description_required');
  });
});

// Both entry points converge on the same trigger_type CHECK constraint
// (data-model.md `developer_report.trigger_type`): agent_detected vs
// user_requested is the only distinction between the two payloads.
describe('developer_report -- shared invariants across both trigger types', () => {
  it('sets trigger_type correctly and distinctly for each origin', () => {
    const agentReport = unwrap(reportAgentDetectedError({ id: 'report-9', errorSummary: 'boom' }));
    const userReport = unwrap(reportUserRequestedIssue({ id: 'report-10', userId: 'user-2', userDescription: 'boom' }));

    expect(agentReport.triggerType).toBe('agent_detected');
    expect(userReport.triggerType).toBe('user_requested');
    expect(agentReport.triggerType).not.toBe(userReport.triggerType);
  });
});
