// Доменна логіка агента -- оркестрація видалення акаунта (AC-17/AC-17b,
// US-11). Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"):
// лише ЩО має статись (впорядкований план), не ЯК він виконується в базі --
// транзакційний запис лишається за App: deleteAccount use-case (T39).
//
// Порядок кроків фіксований і НЕ підлягає перестановці (data-model.md
// `agent_audit_event`, D-89): `account_deleted` пишеться ДО видалення
// `app_user`, бо FK на `agent_audit_event.user_id` -- ON DELETE CASCADE;
// видали `app_user` першим -- і щойно записаний аудит-рядок каскадно
// зникне разом з рештою, а слід видалення акаунта буде втрачено назавжди.

export class AccountDeletionValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AccountDeletionValidationError';
    this.code = code;
  }
}

export interface AccountDeletionInput {
  userId: string;
  // ID для рядка agent_audit_event -- генерується й передається зовні
  // (App-шар, crypto.randomUUID(), той самий підхід, що createCard/
  // insertHistoryEvent): домен лишається чистим і детермінованим, без
  // власних побічних ефектів.
  auditEventId: string;
  // AC-17b: явне підтвердження (слово підтвердження в UI, D-89) -- саме
  // булеве значення, що це підтвердження відбулось, а не сам текст.
  confirmed: boolean;
}

export interface AccountDeletedAuditEvent {
  id: string;
  userId: string;
  eventType: 'account_deleted';
  subjectType: 'account';
  // data-model.md (`agent_audit_event.subject_id`) описує це поле лише для
  // `agent_proposal`/`long_term_memory_fact` -- для subject_type='account'
  // окремої цільової сутності немає (сам обліковий запис і так `user_id`),
  // тож консервативний вибір -- NULL, а не дублювати userId. Позначено як
  // відкрите питання для власника при потребі уточнити.
  subjectId: null;
}

export interface WriteAuditEventStep {
  type: 'write_audit_event';
  auditEvent: AccountDeletedAuditEvent;
}

export interface DeleteAppUserStep {
  type: 'delete_app_user';
  userId: string;
}

export type AccountDeletionStep = WriteAuditEventStep | DeleteAppUserStep;

export interface AccountDeletionPlan {
  steps: AccountDeletionStep[];
}

// AC-17b: без явного підтвердження видалення відмовляється ДО будь-якого
// запису -- випадковий дотик не має призводити до незворотної втрати даних.
export function assertDeletionConfirmed(confirmed: boolean): void {
  if (!confirmed) {
    throw new AccountDeletionValidationError(
      'account.confirmation_required',
      'Видалення акаунта вимагає явного підтвердження (AC-17b)'
    );
  }
}

// AC-17: підтверджене видалення -- впорядкований план із двох кроків.
// Крок 1 (аудит) мусить бути виконаний і завершитись ДО кроку 2 (видалення)
// -- сам план лише описує порядок, виконання (послідовне чи в транзакції)
// лишається за App-шаром.
export function planAccountDeletion(input: AccountDeletionInput): AccountDeletionPlan {
  assertDeletionConfirmed(input.confirmed);

  return {
    steps: [
      {
        type: 'write_audit_event',
        auditEvent: {
          id: input.auditEventId,
          userId: input.userId,
          eventType: 'account_deleted',
          subjectType: 'account',
          subjectId: null,
        },
      },
      {
        type: 'delete_app_user',
        userId: input.userId,
      },
    ],
  };
}
