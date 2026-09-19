// SCR входу через Google Identity Services (GIS) (ISS-52, ADR-0006 "###
// Фронтенд (ISS-52)").
//
// DI, не fetch/GIS напряму (той самий підхід, що DeckScreen.loadCards):
// - renderGoogleButton -- монтує реальну GIS-кнопку в контейнер і підписує
//   колбек на credential (реальна реалізація -- composition root, main.tsx).
// - requestSession -- обмінює Google ID-токен на нашу сесію
//   (POST /api/v1/session, server/app.ts) -- транспорт теж підставляє
//   composition root, компонент лишається presentation-рівнем (ADR-0004).

import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Logo } from '../shared/ui';

export interface SessionUser {
  id: string;
  email: string;
}

export interface SessionResult {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface LoginScreenProps {
  /** Обмінює Google ID-токен (credential з GIS-колбеку) на нашу сесію. */
  requestSession: (googleIdToken: string) => Promise<SessionResult>;
  /** Викликається після успішного обміну -- composition root пише сесію в сховище і перемикає екран. */
  onLoginSuccess: (session: SessionResult) => void;
  /**
   * Монтує GIS-кнопку в переданий контейнер і підписує onCredential на
   * Google-колбек (credential з попапу). Ін'єктовано -- компонент нічого не
   * знає про google.accounts.id.
   *
   * onError -- опційний: реальна реалізація (main.tsx) вантажить GIS-скрипт
   * асинхронно (script blocked, third-party cookies вимкнено тощо) і викликає
   * onError, якщо кнопку не вдалося змонтувати -- LoginScreen показує
   * повідомлення і кнопку "Спробувати ще раз" (Review 2026-09-07 E, T52),
   * що повторно викликає ЦЕЙ проп -- main.tsx відповідає за те, щоб повторний
   * виклик дійсно спробував завантажити скрипт заново (не повернув
   * назавжди-відхилений Promise з попередньої спроби).
   */
  renderGoogleButton: (
    container: HTMLElement,
    onCredential: (credential: string) => void,
    onError?: (message: string) => void,
  ) => void;
}

const GOOGLE_ERROR_MESSAGE = 'Не вдалося завантажити вхід через Google -- спробуйте ще раз';

export function LoginScreen({ requestSession, onLoginSuccess, renderGoogleButton }: LoginScreenProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Review 2026-09-07 E (T52): "Спробувати ще раз" повторно монтує GIS-кнопку
  // БЕЗ перезавантаження сторінки -- інкремент у deps ефекту тригерить той
  // самий цикл заново (той самий підхід, що retryToken у DeckScreen.tsx, C14).
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      renderGoogleButton(
        container,
        (credential) => {
          requestSession(credential)
            .then((session) => {
              setErrorMessage(null);
              onLoginSuccess(session);
            })
            .catch((error: unknown) => {
              setErrorMessage(error instanceof Error ? error.message : GOOGLE_ERROR_MESSAGE);
            });
        },
        (message) => setErrorMessage(message || GOOGLE_ERROR_MESSAGE),
      );
    } catch {
      setErrorMessage(GOOGLE_ERROR_MESSAGE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-bg px-4">
      {/* Та сама "сфумато"-аура, що позаду CardShell (D-120) -- екран входу
          лишається візуально тим самим продуктом, не окремою заставкою. */}
      <div aria-hidden="true" className="absolute -left-16 -top-20 -z-10 h-72 w-72 rounded-full bg-blob-a opacity-90 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-24 -right-10 -z-10 h-64 w-64 rounded-full bg-blob-b opacity-90 blur-3xl" />
      <div aria-hidden="true" className="absolute right-1/3 top-2/3 -z-10 h-48 w-48 rounded-full bg-blob-c opacity-90 blur-3xl" />

      <div className="flex w-full max-w-xs flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="h-48 w-48 text-ink" />
          <h1 className="font-display text-2xl font-bold leading-relaxed tracking-tight text-ink">ПЛАН</h1>
        </div>

        <div ref={containerRef} className="flex justify-center" />

        {errorMessage && (
          <div className="flex w-full flex-col items-center gap-3">
            <Banner variant="error" text={errorMessage} />
            <Button
              label="Спробувати ще раз"
              onClick={() => {
                setErrorMessage(null);
                setRetryToken((token) => token + 1);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}
