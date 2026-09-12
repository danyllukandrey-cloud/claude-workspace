import { describe, it, expect } from 'vitest';
import {
  planAccountDeletion,
  assertDeletionConfirmed,
  AccountDeletionValidationError,
} from './account';
import type { AccountDeletionInput } from './account';

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
  it('throws AccountDeletionValidationError when confirmation is missing', () => {
    expect(() => assertDeletionConfirmed(false)).toThrow(AccountDeletionValidationError);
  });

  it('does not throw when confirmation is explicitly true', () => {
    expect(() => assertDeletionConfirmed(true)).not.toThrow();
  });
});

describe('planAccountDeletion — AC-17b (confirmation guard)', () => {
  it('refuses deletion without the explicit confirmation flag', () => {
    expect(() => planAccountDeletion({ ...baseInput, confirmed: false })).toThrow(
      AccountDeletionValidationError
    );
  });

  it('carries a domain error code usable by an upper layer for HTTP mapping', () => {
    try {
      planAccountDeletion({ ...baseInput, confirmed: false });
      throw new Error('expected planAccountDeletion to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AccountDeletionValidationError);
      expect((err as AccountDeletionValidationError).code).toBe('account.confirmation_required');
    }
  });
});

describe('planAccountDeletion — AC-17 (happy path, ordered plan)', () => {
  it('produces exactly two steps: write account_deleted audit row, then delete app_user', () => {
    const plan = planAccountDeletion(baseInput);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].type).toBe('write_audit_event');
    expect(plan.steps[1].type).toBe('delete_app_user');
  });

  it('the audit step carries an account_deleted event scoped to the user', () => {
    const plan = planAccountDeletion(baseInput);
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
    const plan = planAccountDeletion(baseInput);
    const deleteStep = plan.steps[1];

    if (deleteStep.type !== 'delete_app_user') {
      throw new Error('expected second step to be delete_app_user');
    }
    expect(deleteStep.userId).toBe('user-1');
  });

  it('never reorders the steps -- audit write must precede the app_user delete (D-89: FK CASCADE would drop the audit row otherwise)', () => {
    const plan = planAccountDeletion(baseInput);
    const order = plan.steps.map((step) => step.type);

    expect(order).toEqual(['write_audit_event', 'delete_app_user']);
  });
});
