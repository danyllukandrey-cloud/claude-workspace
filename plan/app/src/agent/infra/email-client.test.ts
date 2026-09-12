import { sendEmail, type EmailTransport } from './email-client';
import { AppError } from '../../shared/errors';

// T37 (tracker.md), AC-20/AC-20b (spec.md): звіт про проблему розробнику
// (developer_report, data-model.md) надсилається поштою. Транспорт (реальний
// SMTP/HTTP-виклик transactional email API) сюди не вбудований -- інжектується
// (той самий DI-принцип, що life-area-card/infra/claude-client.ts), тож нижче
// заглушка стоїть замість реального SMTP/API endpoint (DoD: "Integration test
// against a stub SMTP/API endpoint") -- без мережі й без реальних креденшелів.

describe('sendEmail', () => {
  const email = { to: 'dev@example.test', subject: 'Помилка агента', body: 'опис проблеми й контекст' };

  // AC-20/AC-20b happy path (DoD): send succeeds -> returns delivery confirmation
  it('повертає підтвердження доставки (messageId + час прийняття), коли заглушка SMTP/API endpoint приймає лист', async () => {
    const stubTransport: EmailTransport = async (sent) => {
      expect(sent).toEqual(email);
      return { messageId: 'provider-msg-1' };
    };

    const confirmation = await sendEmail(stubTransport, email);

    expect(confirmation.messageId).toBe('provider-msg-1');
    expect(confirmation.acceptedAt).toBeInstanceOf(Date);
  });

  // AC-20/AC-20b failure path (DoD): send failure surfaces as a typed error, never throws unhandled --
  // сирий виняток заглушки (мережа/провайдер) не проривається до викликача як є.
  it('перетворює відмову заглушки SMTP/API endpoint на типізовану AppError, не прокидає сирий виняток транспорту', async () => {
    const failingTransport: EmailTransport = async () => {
      throw new Error('SMTP timeout -- симуляція недоступності провайдера');
    };

    let caught: unknown;
    try {
      await sendEmail(failingTransport, email);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('email.send_failed');
    expect((caught as AppError).httpStatus).toBe(502);
  });

  // Той самий контракт, коли заглушка відхиляє не-Error значенням (напр. рядок) --
  // AppError.message не має ламатись на цьому, а лишається зрозумілим дефолтом.
  it('дає зрозумілий дефолтний message, коли заглушка відхиляє не-Error значенням', async () => {
    const failingTransport: EmailTransport = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'провайдер повернув 500';
    };

    let caught: unknown;
    try {
      await sendEmail(failingTransport, email);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).message.length).toBeGreaterThan(0);
  });
});
