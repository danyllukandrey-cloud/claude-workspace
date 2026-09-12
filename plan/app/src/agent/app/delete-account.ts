// Use-case "видалити акаунт" (T39, AC-17/AC-17b, US-11) -- виконує впорядкований
// план, який будує чиста доменна функція planAccountDeletion (T34,
// domain/account.ts): крок 1 пише account_deleted у agent_audit_event, крок 2
// видаляє app_user. Порядок кроків НЕ переставляється тут -- він уже
// зафіксований планом і перевірений доменними тестами (D-89: FK CASCADE на
// agent_audit_event.user_id інакше знищила б щойно записаний аудит-рядок
// разом з рештою, коли видаляється app_user).
//
// Sentinel Result (ADR-0006): planAccountDeletion повертає Result, ніколи не
// кидає -- відсутнє підтвердження (AC-17b) мапиться тут явною перевіркою
// `.ok` у типізований AppError (та сама форма, що card.not_found у
// archive-card.ts/T15), ДО будь-якого db.query. Це та єдина точка, де app-шар
// (не domain) дозволено кидати виняток за ADR-0006.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного зʼєднання
// не створює -- композицію робить викликач (ports/composition root, T43).
//
// DELETE FROM app_user -- єдиний запит на видалення, без ручного видалення по
// одній з-поміж 6 власних таблиць агента чи life-area-card.card/
// structure.structure: каскад робить сама PostgreSQL через ON DELETE CASCADE
// (data-model.md `agent_audit_event`/`agent_proposal`/`imperative_rule`/
// `long_term_memory_fact`/`chat_message`/`activity_report`.user_id, плюс
// card.owner_user_id/structure.owner_user_id -- FK CASCADE додано 2026-08-29,
// migrations life-area-card/07 і structure/backend/03). `sync_resource`
// теж каскадить на app_user (T31), `developer_report` навмисно ON DELETE
// SET NULL (data-model.md Notes) -- звіт про баг не має зникати з акаунтом,
// що його спричинив, тож лишається сиротою, не видаляється.
//
// app_user не має власного репозиторного модуля в agent/infra (та сама
// конвенція, що server/app.ts upsertAppUser -- "SQL напряму, без ORM"):
// єдиний виклик тут не виправдовує окремої функції в postgres-repo.ts.

import { randomUUID } from 'node:crypto';
import { planAccountDeletion } from '../domain/account';
import type { AccountDeletionStep } from '../domain/account';
import { insertAuditEvent } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

export interface DeleteAccountInput {
  userId: string;
  // AC-17b: явне підтвердження (слово підтвердження перевіряється на
  // UI-рівні, openapi.yaml /api/v1/account delete) -- сюди доходить лише
  // булеве значення факту підтвердження, той самий контракт, що
  // domain/account.ts AccountDeletionInput.confirmed.
  confirmed: boolean;
}

async function runStep(db: Db, step: AccountDeletionStep): Promise<void> {
  switch (step.type) {
    case 'write_audit_event':
      await insertAuditEvent(db, {
        id: step.auditEvent.id,
        userId: step.auditEvent.userId,
        eventType: step.auditEvent.eventType,
        subjectType: step.auditEvent.subjectType,
        subjectId: step.auditEvent.subjectId,
      });
      return;
    case 'delete_app_user':
      await db.query('DELETE FROM app_user WHERE id = $1', [step.userId]);
      return;
  }
}

export async function deleteAccount(db: Db, input: DeleteAccountInput): Promise<void> {
  const plan = planAccountDeletion({
    userId: input.userId,
    auditEventId: randomUUID(),
    confirmed: input.confirmed,
  });

  // AC-17b: guard мапиться в AppError ДО першого db.query -- випадковий
  // дотик без явного підтвердження не має призводити до жодного запису.
  if (!plan.ok) {
    throw new AppError(plan.error.code, plan.error.message, 400);
  }

  // AC-17: кроки виконуються послідовно в порядку, який визначив домен --
  // аудит-рядок ЗАВЖДИ пишеться до видалення app_user (D-89).
  for (const step of plan.value.steps) {
    await runStep(db, step);
  }
}
