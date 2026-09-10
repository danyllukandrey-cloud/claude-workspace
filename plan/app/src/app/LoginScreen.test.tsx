// RED (ISS-52, ADR-0006 "### Фронтенд (ISS-52)"): екран входу через Google
// Identity Services (GIS).
//
// GIS вантажиться зовнішнім <script> (не npm-пакет) і сам показує стандартний
// Google-попап -- юніт-тест не може (і не повинен) чекати на реальний скрипт
// чи мережу. Тому LoginScreen отримує GIS-інтеграцію через ІН'ЄКТОВАНИЙ проп
// renderGoogleButton (той самий підхід DI, що вже в DeckScreen.loadCards,
// app/*.ts картки -- callClaude/closeStructurePosition): реальна реалізація
// (майбутня задача) викличе google.accounts.id.initialize({ client_id,
// callback }) + renderButton(container, ...); тест підставляє фейкову
// функцію, що синхронно "натискає" Google-кнопку, викликаючи колбек
// onCredential напряму -- жодного реального GIS і жодної мережі не потрібно.
//
// Обмін credential -> {token, expiresAt, user} -- теж ін'єктований (proп
// requestSession), а не fetch напряму в компоненті: точну форму запиту/
// відповіді POST /api/v1/session (T30, server/app.ts) підставляє composition
// root (майбутній main.tsx/App.tsx), компонент лишається presentation-рівнем
// без знання про транспорт (ADR-0004).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginScreen } from './LoginScreen';
import type { SessionResult } from './LoginScreen';

const SESSION_RESULT: SessionResult = {
  token: 'signed.jwt.token',
  expiresAt: '2026-09-07T00:00:00.000Z',
  user: { id: 'app-user-1', email: 'andrii@example.com' },
};

// Повідомлення буквально те, що повертає POST /api/v1/session при 401
// (server/app.ts: new AppError('auth.invalid_google_token', ...)) -- LoginScreen
// не вигадує власний текст помилки, а показує те, що прийшло від бекенду.
const INVALID_TOKEN_MESSAGE = 'Невалідний або протермінований Google ID-токен';

test('на GIS-колбек з credential викликає requestSession і передає результат в onLoginSuccess', async () => {
  const requestSession = vi.fn().mockResolvedValue(SESSION_RESULT);
  const onLoginSuccess = vi.fn();
  let capturedOnCredential: ((credential: string) => void) | undefined;
  const renderGoogleButton = vi.fn((container: HTMLElement, onCredential: (credential: string) => void) => {
    expect(container).toBeInstanceOf(HTMLElement);
    capturedOnCredential = onCredential;
  });

  render(
    <LoginScreen
      requestSession={requestSession}
      onLoginSuccess={onLoginSuccess}
      renderGoogleButton={renderGoogleButton}
    />,
  );

  // LoginScreen монтує GIS-кнопку одразу при рендері (ADR-0006, крок 2).
  expect(renderGoogleButton).toHaveBeenCalledTimes(1);

  // Симулюємо, що користувач пройшов Google-попап -- GIS викликає наш колбек
  // з ID-токеном (тут: 'fake-google-id-token").
  capturedOnCredential?.('fake-google-id-token');

  await waitFor(() => expect(requestSession).toHaveBeenCalledWith('fake-google-id-token'));
  await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith(SESSION_RESULT));
});

test('при відхиленні requestSession (401 auth.invalid_google_token) показує помилку і НЕ викликає onLoginSuccess', async () => {
  const requestSession = vi.fn().mockRejectedValue(new Error(INVALID_TOKEN_MESSAGE));
  const onLoginSuccess = vi.fn();
  let capturedOnCredential: ((credential: string) => void) | undefined;
  const renderGoogleButton = vi.fn((_container: HTMLElement, onCredential: (credential: string) => void) => {
    capturedOnCredential = onCredential;
  });

  render(
    <LoginScreen
      requestSession={requestSession}
      onLoginSuccess={onLoginSuccess}
      renderGoogleButton={renderGoogleButton}
    />,
  );

  capturedOnCredential?.('bad-google-id-token');

  expect(await screen.findByText(INVALID_TOKEN_MESSAGE)).toBeTruthy();
  expect(onLoginSuccess).not.toHaveBeenCalled();
});

// Review 2026-09-07 E (RED, T52): "помилка завантаження GIS-скрипта
// кешується назавжди, попри задокументований retry-афорданс" -- досі
// ЄДИНИМ способом повторити спробу було перезавантажити всю сторінку
// (main.tsx кешує Promise на рівні модуля назавжди). Тепер кнопка
// "Спробувати ще раз" повторно викликає injected renderGoogleButton --
// реальна реалізація (main.tsx) відповідає за те, щоб ЦЕЙ повторний
// виклик дійсно спробував завантажити скрипт заново, не повернув той
// самий відхилений Promise.

test('онError від renderGoogleButton показує Banner І кнопку "Спробувати ще раз"', () => {
  const renderGoogleButton = vi.fn((_container: HTMLElement, _onCredential: unknown, onError?: (message: string) => void) => {
    onError?.('Не вдалося завантажити вхід через Google -- спробуйте ще раз');
  });

  render(
    <LoginScreen requestSession={vi.fn()} onLoginSuccess={vi.fn()} renderGoogleButton={renderGoogleButton} />,
  );

  expect(screen.getByText('Не вдалося завантажити вхід через Google -- спробуйте ще раз')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Спробувати ще раз' })).toBeTruthy();
});

test('клік "Спробувати ще раз" повторно викликає renderGoogleButton, без перезавантаження сторінки', () => {
  const renderGoogleButton = vi.fn((_container: HTMLElement, _onCredential: unknown, onError?: (message: string) => void) => {
    onError?.('Не вдалося завантажити вхід через Google -- спробуйте ще раз');
  });

  render(
    <LoginScreen requestSession={vi.fn()} onLoginSuccess={vi.fn()} renderGoogleButton={renderGoogleButton} />,
  );

  expect(renderGoogleButton).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));

  expect(renderGoogleButton).toHaveBeenCalledTimes(2);
});
