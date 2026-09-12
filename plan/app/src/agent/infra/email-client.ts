// Обгортка над вихідним email-провайдером (SMTP чи transactional email API --
// конкретний постачальник ще не обраний) для звіту про проблему розробнику
// (AC-20/AC-20b, data-model.md `developer_report`, tracker.md T37).
//
// Той самий принцип DI, що й life-area-card/infra/claude-client.ts: сам
// SMTP/HTTP-виклик сюди НЕ вбудований -- `transport` інжектується ззовні
// (у продакшн-wiring, T29, підставиться справжній виклик; тут і в тестах --
// заглушка). Завдяки цьому модуль лишається тестованим без мережі й без
// реальних креденшелів.

import { AppError } from '../../shared/errors';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailDeliveryConfirmation {
  messageId: string;
  acceptedAt: Date;
}

/**
 * Інжектована функція реального надсилання (SMTP-клієнт чи HTTP-виклик
 * transactional email API). Приймає лист, повертає ідентифікатор
 * повідомлення від провайдера -- або відхиляється (мережа, timeout,
 * провайдер відхилив запит) будь-якою формою помилки.
 */
export type EmailTransport = (email: OutboundEmail) => Promise<{ messageId: string }>;

/**
 * Надсилає лист через інжектований transport (AC-20/AC-20b: звіт розробнику
 * про технічну помилку -- агентом виявлену чи переказану користувачем).
 *
 * DoD (tracker.md T37): успіх повертає підтвердження доставки; будь-яка
 * відмова transport (мережа недоступна, провайдер відхилив, timeout)
 * ловиться тут і перетворюється на типізовану `AppError('email.send_failed',
 * ..., 502)` -- ніколи не проривається до викликача сирим/некерованим
 * винятком транспорту.
 */
export async function sendEmail(transport: EmailTransport, email: OutboundEmail): Promise<EmailDeliveryConfirmation> {
  let providerResult: { messageId: string };
  try {
    providerResult = await transport(email);
  } catch (error) {
    throw new AppError('email.send_failed', toMessage(error), 502);
  }
  return { messageId: providerResult.messageId, acceptedAt: new Date() };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не вдалося надіслати лист -- провайдер відхилив запит';
}
