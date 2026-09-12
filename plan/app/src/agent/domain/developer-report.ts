// Доменна логіка "Агента" -- класифікація звіту розробнику (US-14, AC-20/AC-20b).
// Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"): обидва
// джерела звіту (агент сам виявив помилку / користувач попросив переслати
// проблему) зводяться до однієї моделі `DeveloperReport`, що відповідає
// таблиці `developer_report` (data-model.md) -- лише поля, обчислювані ДО
// збереження/відправки; `sentAt` -- DEFAULT БД, тут не обчислюється.

export type DeveloperReportTriggerType = 'agent_detected' | 'user_requested';
export type DeveloperReportDeliveryStatus = 'sent' | 'failed';

export interface DeveloperReport {
  id: string;
  /** NULL допустимо -- агент може виявити помилку поза контекстом користувача. */
  userId: string | null;
  triggerType: DeveloperReportTriggerType;
  description: string;
  /**
   * Початковий стан ДО фактичної спроби відправки листа (T37/T42) --
   * той самий дефолт, що в схемі (`DEFAULT 'sent'`). Use-case шар (T42)
   * переводить у 'failed', якщо реальна відправка не вдалась.
   */
  deliveryStatus: DeveloperReportDeliveryStatus;
}

export class DeveloperReportValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeveloperReportValidationError';
    this.code = code;
  }
}

// `description` -- NOT NULL у схемі (data-model.md `developer_report.description`).
function assertNonEmptyDescription(value: string): void {
  if (value == null || !value.trim()) {
    throw new DeveloperReportValidationError(
      'developer_report.description_required',
      'Опис звіту обовʼязковий',
    );
  }
}

// AC-20 -- агент сам виявив технічну помилку чи збій. Вхід свідомо НЕ має
// поля з текстом користувача: службова дія без його участі, тому й
// формувати опис нема з чого, крім того, що знає сам агент.
export interface AgentDetectedErrorInput {
  id: string;
  /** NULL, якщо помилка сталась поза контекстом конкретної сесії користувача. */
  userId?: string | null;
  errorSummary: string;
  /** Додатковий контекст (що саме робив агент, коли стався збій) -- необовʼязково. */
  context?: string | null;
}

export function reportAgentDetectedError(input: AgentDetectedErrorInput): DeveloperReport {
  assertNonEmptyDescription(input.errorSummary);
  const description =
    input.context && input.context.trim().length > 0
      ? `${input.errorSummary} — ${input.context}`
      : input.errorSummary;

  return {
    id: input.id,
    userId: input.userId ?? null,
    triggerType: 'agent_detected',
    description,
    deliveryStatus: 'sent',
  };
}

// AC-20b -- користувач сам просить переслати проблему. Опис зберігається
// дослівно (переказ слів користувача, data-model.md), тому тут НІЯКОГО
// trim/rewrite понад те, що вводить сама валідація (яка лише ВІДХИЛЯЄ
// порожній рядок, не змінює непорожній).
export interface UserRequestedReportInput {
  id: string;
  userId?: string | null;
  userDescription: string;
}

export function reportUserRequestedIssue(input: UserRequestedReportInput): DeveloperReport {
  assertNonEmptyDescription(input.userDescription);

  return {
    id: input.id,
    userId: input.userId ?? null,
    triggerType: 'user_requested',
    description: input.userDescription,
    deliveryStatus: 'sent',
  };
}
