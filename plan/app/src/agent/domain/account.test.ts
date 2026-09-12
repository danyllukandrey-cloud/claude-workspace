import { describe, it, expect } from 'vitest';
import { planAccountDeletion, assertDeletionConfirmed } from './account';
import type { AccountDeletionInput, AccountDeletionPlan } from './account';

/** Розпаковує `Result<AccountDeletionPlan, AccountDeletionError>` для happy-path тестів. */
function unwrap(result: ReturnType<typeof planAccountDeletion>): AccountDeletionPlan {
  if (!result.ok) {
    throw new Error(`очікувалось ok, отримано err: ${result.error.code}`);
  }
  return result.value;
}

// T34 -- лише "ядро": чисте доменне правило без I/O (plan/app/CLAUDE.md,
// "domain -> НІЧОГО"). Тут перевіряється лише ЩО має статись (впорядкований
// план), не ЯК він виконується в базі -- це предмет App: deleteAccount
// use-case (T39).

const baseInput: AccountDeletionInput = {
  userId: 'user-1',
  auditEventId: 'audit-1',
  confirmed: true,
};

describe('assertDeletionConfirmed — AC-17b (confirmation guard)', () => {
  it('returns an err (ADR-0006 sentinel, not a throw) when confirmation is missing', () => {
    const result = assertDeletionConfirmed(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('account.confirmation_required');
  });

  it('returns ok when confirmation is explicitly true', () => {
    expect(assertDeletionConfirmed(true)).toEqual({ ok: true, value: true });
  });
});

describe('planAccountDeletion — AC-17b (confirmation guard)', () => {
  it('refuses deletion without the explicit confirmation flag -- ADR-0006 sentinel, not a throw', () => {
    const result = planAccountDeletion({ ...baseInput, confirmed: false });
    expect(result.ok).toBe(false);
  });

  it('carries a domain error code usable by an upper layer for HTTP mapping', () => {
    const result = planAccountDeletion({ ...baseInput, confirmed: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('account.confirmation_required');
  });
});

describe('planAccountDeletion — AC-17 (happy path, ordered plan)', () => {
  it('produces exactly two steps: write account_deleted audit row, then delete app_user', () => {
    const plan = unwrap(planAccountDeletion(baseInput));

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].type).toBe('write_audit_event');
    expect(plan.steps[1].type).toBe('delete_app_user');
  });

  it('the audit step carries an account_deleted event scoped to the user', () => {
    const plan = unwrap(planAccountDeletion(baseInput));
    const auditStep = plan.steps[0];

    if (auditStep.type !== 'write_audit_event') {
      throw new Error('expected first step to be write_audit_event');
    }
    expect(auditStep.auditEvent).toEqual({
      id: 'audit-1',
      userId: 'user-1',
      eventType: 'account_deleted',
      subjectType: 'account',
      subjectId: null,
    });
  });

  it('the delete step targets the same user_id as the audit step', () => {
    const plan = unwrap(planAccountDeletion(baseInput));
    const deleteStep = plan.steps[1];

    if (deleteStep.type !== 'delete_app_user') {
      throw new Error('expected second step to be delete_app_user');
    }
    expect(deleteStep.userId).toBe('user-1');
  });

  it('never reorders the steps -- audit write must precede the app_user delete (D-89: FK CASCADE would drop the audit row otherwise)', () => {
    const plan = unwrap(planAccountDeletion(baseInput));
    const order = plan.steps.map((step) => step.type);

    expect(order).toEqual(['write_audit_event', 'delete_app_user']);
  });
});
