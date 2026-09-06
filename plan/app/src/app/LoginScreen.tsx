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
import { Banner } from '../shared/ui';

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
   * повідомлення, сама GIS-кнопка (контейнер) лишається на місці як retry-
   * афорданс (окремої кнопки "спробувати ще раз" немає).
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
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>ПЛАН</h1>
      <div ref={containerRef} />
      {errorMessage && <Banner variant="error" text={errorMessage} />}
    </main>
  );
}
