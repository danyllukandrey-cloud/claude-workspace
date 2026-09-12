// T18 (agent/app/ask-agent.ts) -- orchestrates the Claude call (T12) +
// guard-check (T9), sad.md §6 Critical flow 6 (AC-07). Mocks `AskClaude`
// directly via vi.fn() -- the same "mock the injected function, not the
// network" style already used for `db.query` in
// cards/life-area-card/app/create-entry.test.ts; no HTTP stub needed here
// because T12's own claude-client.test.ts already covers the real
// request/response round-trip.
//
// DoD (integration test, documents intended real-DB-adjacent behaviour
// against a mocked AskClaude, per the same convention as the rest of
// plan/app/src/agent/): "a reply that would violate the user's active rule
// is discarded and retried once without the offending content; the guard
// result (pass/fail) is returned for audit logging" -- covered by
// 'discards a rule-violating draft and retries exactly once ...' below.

import { describe, it, expect, vi } from 'vitest';
import { askAgent } from './ask-agent';
import type { AskClaude, ClaudeResult } from '../infra/claude-client';
import { AppError } from '../../shared/errors';
import type { ImperativeRule } from '../domain/rules';

function rule(overrides: Partial<ImperativeRule> = {}): ImperativeRule {
  return {
    id: 'rule-1',
    userId: 'user-1',
    scopeCardId: null,
    category: null,
    ruleText: 'не радь, якщо не питаю',
    ...overrides,
  };
}

function okResult(value: string): ClaudeResult<string> {
  return { ok: true, value };
}

describe('askAgent (T18: ask-agent orchestration)', () => {
  // Happy path (AC-07): no active rule is violated -- one Claude call, no retry.
  it('returns the first draft unchanged when it passes the guard check', async () => {
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okResult('Записав 5 км бігу.'));

    const result = await askAgent(askClaude, {
      text: 'пробіг 5 км',
      activeRules: [rule()],
    });

    expect(askClaude).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      reply: 'Записав 5 км бігу.',
      guard: { passed: true, violatedRuleId: null, reason: null },
      retried: false,
    });
  });

  // The active rule's text must reach Claude's system prompt (Flow 6: "запит
  // на розбір + системний промпт з правилом користувача") -- not silently
  // dropped, otherwise the model has no way to actually follow AC-07.
  it('includes the active rule text in the system prompt sent to Claude', async () => {
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okResult('Записав 5 км бігу.'));

    await askAgent(askClaude, {
      text: 'пробіг 5 км',
      baseSystemPrompt: 'Ти агент ПЛАНу.',
      activeRules: [rule({ ruleText: 'не радь, якщо не питаю' })],
    });

    const sentPrompt = askClaude.mock.calls[0][0].systemPrompt;
    expect(sentPrompt).toContain('Ти агент ПЛАНу.');
    expect(sentPrompt).toContain('не радь, якщо не питаю');
  });

  // Core DoD: a rule-violating draft is discarded (never returned) and
  // retried exactly once without the offending content; the guard result is
  // returned for the caller to write into agent_audit_event.
  it('discards a rule-violating draft and retries exactly once without the offending content', async () => {
    const askClaude = vi
      .fn<AskClaude>()
      .mockResolvedValueOnce(okResult('Раджу спробувати щоденні пробіжки.'))
      .mockResolvedValueOnce(okResult('Записав біг сьогодні.'));

    const result = await askAgent(askClaude, {
      text: 'бігав сьогодні',
      activeRules: [rule({ id: 'rule-advice', ruleText: 'не радь, якщо не питаю' })],
    });

    expect(askClaude).toHaveBeenCalledTimes(2);
    // The violating first draft never reaches the caller's reply.
    expect(result.reply).toBe('Записав біг сьогодні.');
    expect(result.reply).not.toContain('Раджу');
    expect(result.retried).toBe(true);
    // Guard result returned for audit logging (DoD) -- reflects the retry's
    // own check, which this time passed.
    expect(result.guard).toEqual({ passed: true, violatedRuleId: null, reason: null });

    // The retry must actually ask Claude to drop the offending content, not
    // just repeat the exact same request.
    const firstPrompt = askClaude.mock.calls[0][0].systemPrompt ?? '';
    const retryPrompt = askClaude.mock.calls[1][0].systemPrompt ?? '';
    expect(retryPrompt).not.toBe(firstPrompt);
    expect(retryPrompt.length).toBeGreaterThan(firstPrompt.length);
  });

  // spec.md §6 NFR "максимум одна повторна спроба" -- even if the retry ALSO
  // violates the rule, there is no third attempt; the (failing) guard result
  // from the retry is still returned so the caller can log guard_failed.
  it('does not retry more than once even when the second draft also violates the rule', async () => {
    const askClaude = vi
      .fn<AskClaude>()
      .mockResolvedValueOnce(okResult('Раджу спробувати щоденні пробіжки.'))
      .mockResolvedValueOnce(okResult('Все одно раджу пробіжки.'));

    const result = await askAgent(askClaude, {
      text: 'бігав сьогодні',
      activeRules: [rule({ id: 'rule-advice', ruleText: 'не радь, якщо не питаю' })],
    });

    expect(askClaude).toHaveBeenCalledTimes(2);
    expect(result.retried).toBe(true);
    expect(result.guard.passed).toBe(false);
    expect(result.guard.violatedRuleId).toBe('rule-advice');
  });

  // No active rules at all -- guard always passes (domain/guard.ts), draft is
  // returned as-is, single call.
  it('passes through when there are no active rules', async () => {
    const askClaude = vi.fn<AskClaude>().mockResolvedValue(okResult('Раджу спробувати щоденні пробіжки.'));

    const result = await askAgent(askClaude, { text: 'бігав сьогодні', activeRules: [] });

    expect(askClaude).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      reply: 'Раджу спробувати щоденні пробіжки.',
      guard: { passed: true, violatedRuleId: null, reason: null },
      retried: false,
    });
  });

  // A custom isViolating predicate (DI hook, T9 Neutral consequence) is used
  // instead of the default keyword heuristic when the caller supplies one.
  it('uses a custom isViolating predicate when provided', async () => {
    const askClaude = vi
      .fn<AskClaude>()
      .mockResolvedValueOnce(okResult('перша чернетка'))
      .mockResolvedValueOnce(okResult('друга чернетка'));
    const isViolating = vi.fn((draftReply: string) => draftReply === 'перша чернетка');

    const result = await askAgent(askClaude, {
      text: 'щось',
      activeRules: [rule()],
      isViolating,
    });

    expect(isViolating).toHaveBeenCalled();
    expect(result.retried).toBe(true);
    expect(result.reply).toBe('друга чернетка');
  });

  // Claude unavailable / timeout (sad.md Critical flow 2) -- mapped to
  // AppError('agent.llm_unavailable', 503, contracts/openapi.yaml), not
  // thrown as a raw ClaudeError, and not retried at this boundary (the
  // guard-driven retry above only fires on a SUCCESSFUL draft).
  it('maps a Claude-unavailable failure to AppError agent.llm_unavailable (503) without retrying', async () => {
    const askClaude = vi
      .fn<AskClaude>()
      .mockResolvedValue({ ok: false, error: { code: 'claude.unavailable', message: 'Claude API недоступний' } });

    await expect(askAgent(askClaude, { text: 'бігав', activeRules: [] })).rejects.toMatchObject({
      code: 'agent.llm_unavailable',
      httpStatus: 503,
    });
    await expect(
      askAgent(vi.fn<AskClaude>().mockResolvedValue({ ok: false, error: { code: 'claude.unavailable', message: 'x' } }), {
        text: 'бігав',
        activeRules: [],
      })
    ).rejects.toBeInstanceOf(AppError);
    expect(askClaude).toHaveBeenCalledTimes(1);
  });

  // Unsupported attachment (AC-10b/AC-19b) -- mapped to
  // AppError('agent.attachment_unrecognized', 422), symmetric with
  // contracts/openapi.yaml.
  it('maps an unsupported-attachment failure to AppError agent.attachment_unrecognized (422)', async () => {
    const askClaude = vi.fn<AskClaude>().mockResolvedValue({
      ok: false,
      error: { code: 'claude.unsupported_attachment', message: 'Непідтримуваний тип вкладення: application/zip' },
    });

    await expect(
      askAgent(askClaude, {
        text: null,
        attachment: { mediaType: 'application/zip', base64Data: 'AAAA' },
        activeRules: [],
      })
    ).rejects.toMatchObject({ code: 'agent.attachment_unrecognized', httpStatus: 422 });
  });

  // A failure on the RETRY call (second askClaude invocation) is mapped and
  // thrown the same way as a first-call failure -- the caller still needs a
  // typed AppError, not a silently swallowed retry.
  it('maps a failure on the retry call the same way as a first-call failure', async () => {
    const askClaude = vi
      .fn<AskClaude>()
      .mockResolvedValueOnce(okResult('Раджу спробувати щоденні пробіжки.'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'claude.unavailable', message: 'Claude API недоступний' } });

    await expect(
      askAgent(askClaude, {
        text: 'бігав сьогодні',
        activeRules: [rule({ id: 'rule-advice', ruleText: 'не радь, якщо не питаю' })],
      })
    ).rejects.toMatchObject({ code: 'agent.llm_unavailable', httpStatus: 503 });
    expect(askClaude).toHaveBeenCalledTimes(2);
  });
});
