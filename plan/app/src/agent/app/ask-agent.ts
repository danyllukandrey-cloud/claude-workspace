// T18 -- App: ask-agent orchestration (Claude call + guard check).
// sad.md §5 "ask-agent.ts # оркеструє виклик Claude API + guard-перевірку",
// §6 Critical flow 6 (AC-07). Sits between infra/claude-client.ts (T12) and
// domain/guard.ts (T9) -- deps in tasks.json are exactly T9+T12, not T13
// (postgres-repo): this module never touches the database itself. The caller
// (future T16 handle-message.ts) already knows the effective active rules
// for the current card (`listEffectiveRulesForCard`, T13) and passes them in;
// this module returns the guard verdict so the SAME caller can write the
// `agent_audit_event` row (`guard_passed`/`guard_failed`, data-model.md) --
// "returned for audit logging" (DoD), not written here.
//
// DI (plan/app/CLAUDE.md, ADR-0005): `askClaude` (T12's AskClaude) is injected,
// never constructed here -- same pattern as `db` elsewhere in app/.
//
// ADR-0004 (Accepted) + spec.md §6 NFR ("максимум одна повторна спроба"):
// exactly ONE retry on a guard failure, never a loop. A draft that violates
// an active rule is discarded outright -- it is never returned to the caller,
// even transiently -- and a second request is sent with an explicit
// instruction to drop the offending content. Whatever the retry produces
// (pass or still fail) is final: no third attempt, matching the NFR's
// "maximum one retry" wording literally.
//
// Domain-sentinel boundary (ADR-0006, docs/features/agent/adr/0006-...):
// domain/guard.ts's `runGuardCheck` is a pure function that never throws --
// checked here via its return shape. `askClaude` (infra, T12) is the OTHER
// convention already documented at its own definition: it returns
// `ClaudeResult<T>` for every expected failure, never throws. This app-layer
// module is the boundary that maps a Claude `Err` into a thrown `AppError`
// (same contract note left in claude-client.ts) -- codes mirror
// contracts/openapi.yaml POST /api/v1/messages error responses:
//   - claude.unsupported_attachment -> agent.attachment_unrecognized (422, AC-10b/AC-19b)
//   - claude.unavailable / claude.unexpected_response -> agent.llm_unavailable (503, Critical flow 2)
// The openapi.yaml contract has no separate code for a malformed/unexpected
// response body -- mapping it to the same 503 as a network failure is the
// most conservative reading available here, not a separately confirmed
// decision; flagged for the human to revisit if a distinct code is ever needed.

import type { AskClaude, AskClaudeInput, ClaudeAttachment, ClaudeError } from '../infra/claude-client';
import { runGuardCheck, defaultRuleViolationCheck } from '../domain/guard';
import type { GuardResult, RuleViolationCheck } from '../domain/guard';
import type { ImperativeRule } from '../domain/rules';
import { AppError } from '../../shared/errors';

export interface AskAgentInput {
  /** Текст користувача (AC-01) -- null, коли повідомлення лише вкладення (AC-10/AC-19). */
  text: string | null;
  /** Вкладення (AC-10/AC-19) -- відсутнє/null для чистого тексту. */
  attachment?: ClaudeAttachment | null;
  /**
   * Базовий системний промпт (базові правила + меню категорій, sad.md §4) --
   * БЕЗ власних правил користувача. `askAgent` сам дописує знизу активні
   * правила (`activeRules`) -- той самий склад, що Flow 6 sad.md §6 "запит на
   * розбір + системний промпт з правилом користувача".
   */
  baseSystemPrompt?: string;
  /**
   * Активні правила для поточного контексту -- глобальні + card-override,
   * ВЖЕ вирішені викликачем (`listEffectiveRulesForCard`, T13/AC-12). Порожній
   * масив -- guard завжди проходить (немає що порушувати, domain/guard.ts).
   */
  activeRules: ImperativeRule[];
  /**
   * DI-гачок механізму виявлення порушення (T9 Neutral consequence, ADR-0004)
   * -- дефолт `defaultRuleViolationCheck` (keyword-евристика для канонічного
   * "не радь, якщо не питаю", AC-07). Викликач підставляє власний (напр.
   * LLM-based) для довільного вільного тексту правила, що ця евристика не
   * покриває.
   */
  isViolating?: RuleViolationCheck;
}

export interface AskAgentResult {
  /** Фінальна відповідь, що йде користувачу -- ніколи чернетка, що провалила guard. */
  reply: string;
  /**
   * Guard-вердикт ОСТАННЬОЇ виконаної перевірки (першої, якщо вона пройшла;
   * інакше -- повторної) -- те саме значення, яке викликач пише як
   * `guard_passed`/`guard_failed` в `agent_audit_event` (DoD: "returned for
   * audit logging").
   */
  guard: GuardResult;
  /** true -- перша чернетка порушила активне правило, і це вже друга спроба. */
  retried: boolean;
}

/**
 * Оркеструє один хід "запит -> чернетка -> guard [-> одна повторна спроба]"
 * (sad.md §6 Critical flow 6, AC-07). Ніколи не показує (і не повертає)
 * чернетку, що провалила guard-перевірку -- вона відкидається одразу, ще
 * до того, як опиниться десь поза цією функцією.
 */
export async function askAgent(askClaude: AskClaude, input: AskAgentInput): Promise<AskAgentResult> {
  const isViolating = input.isViolating ?? defaultRuleViolationCheck;
  const systemPrompt = buildSystemPrompt(input.baseSystemPrompt, input.activeRules);

  const draft = await callClaudeOrThrow(askClaude, {
    systemPrompt,
    text: input.text,
    attachment: input.attachment ?? null,
  });
  const guard = runGuardCheck(draft, input.activeRules, isViolating);

  if (guard.passed) {
    return { reply: draft, guard, retried: false };
  }

  // AC-07 + ADR-0004 + DoD T18: чернетка, що порушує правило, відкидається --
  // повторний запит формується БЕЗ порушеного змісту (явна інструкція нижче),
  // максимум одна повторна спроба (spec.md §6 NFR).
  const retrySystemPrompt = `${systemPrompt}\n\n${buildRetryDirective(guard)}`;
  const retryDraft = await callClaudeOrThrow(askClaude, {
    systemPrompt: retrySystemPrompt,
    text: input.text,
    attachment: input.attachment ?? null,
  });
  const retryGuard = runGuardCheck(retryDraft, input.activeRules, isViolating);

  return { reply: retryDraft, guard: retryGuard, retried: true };
}

/**
 * sad.md §4/§6 Flow 6: системний промпт несе і базові правила (D-94 пізніша
 * примітка ADR-0004 -- подається заново при КОЖНОМУ виклику, не лише
 * "пригадується"), і активні правила користувача. Порожній список активних
 * правил -- лише базовий промпт, нічого дописувати нема.
 */
function buildSystemPrompt(baseSystemPrompt: string | undefined, activeRules: ImperativeRule[]): string {
  const base = baseSystemPrompt ?? '';
  if (activeRules.length === 0) {
    return base;
  }

  const rulesText = activeRules.map((rule) => `- ${rule.ruleText ?? rule.category}`).join('\n');
  const rulesBlock = `Активні правила користувача (дотримуйся їх у КОЖНІЙ відповіді, AC-07/AC-12):\n${rulesText}`;

  return base.length > 0 ? `${base}\n\n${rulesBlock}` : rulesBlock;
}

/** DoD T18: "retried once without the offending content" -- явна інструкція прибрати саме порушену частину. */
function buildRetryDirective(guard: GuardResult): string {
  const violated = guard.reason ? ` ("${guard.reason}")` : '';
  return (
    `Попередня чернетка порушила активне правило користувача${violated}. ` +
    'Сформуй нову відповідь БЕЗ цього порушення -- прибери саме ту частину, ' +
    'що порушувала правило, суть відповіді на решту повідомлення збережи.'
  );
}

function mapClaudeError(error: ClaudeError): AppError {
  if (error.code === 'claude.unsupported_attachment') {
    // Symmetric with contracts/openapi.yaml 422 agent.attachment_unrecognized (AC-10b/AC-19b).
    return new AppError('agent.attachment_unrecognized', error.message, 422);
  }
  // claude.unavailable / claude.unexpected_response -- both map to the same
  // 503 as sad.md Critical flow 2 / contracts/openapi.yaml agent.llm_unavailable.
  // No retry at THIS boundary (accepted debt, sad.md §11) -- distinct from the
  // guard-driven retry above, which only fires on a successfully returned draft.
  return new AppError('agent.llm_unavailable', error.message, 503);
}

async function callClaudeOrThrow(askClaude: AskClaude, request: AskClaudeInput): Promise<string> {
  const result = await askClaude(request);
  if (!result.ok) {
    throw mapClaudeError(result.error);
  }
  return result.value;
}
