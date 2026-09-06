// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useState } from 'react';
import { CreateCardForm, DeckScreen } from '../cards/life-area-card';
import type { DeckGridItem } from '../cards/life-area-card';
import { LoginScreen } from './LoginScreen';
import type { SessionResult } from './LoginScreen';

export interface StoredSession {
  token: string;
  expiresAt: string;
}

export interface AppProps {
  /** Читає поточну сесію зі сховища (null -- немає збереженого токена). */
  readStoredSession: () => StoredSession | null;
  /** Пише сесію у сховище після успішного входу. */
  writeStoredSession: (session: StoredSession) => void;
  /** Поточний час -- ін'єктовано для детермінованого порівняння з expiresAt. */
  now: () => Date;
  /** Обмінює Google ID-токен на сесію (POST /api/v1/session). */
  requestSession: (googleIdToken: string) => Promise<SessionResult>;
  /** Монтує GIS-кнопку (LoginScreen). */
  renderGoogleButton: (
    container: HTMLElement,
    onCredential: (credential: string) => void,
    onError?: (message: string) => void,
  ) => void;
  /** Завантажує колоду карток (DeckScreen). */
  loadCards: () => Promise<DeckGridItem[]>;
  /** Відкриття картки з колоди (DeckScreen). */
  onOpenCard: (cardId: string) => void;
  /** Створює нову картку (POST /cards, CreateCardForm.onCreate, ISS-55). */
  createCard: (input: { name: string }) => Promise<void>;
}

type Screen = 'deck' | 'create';

function isSessionValid(session: StoredSession | null, now: () => Date): boolean {
  if (!session) return false;
  return new Date(session.expiresAt).getTime() > now().getTime();
}

export function App({
  readStoredSession,
  writeStoredSession,
  now,
  requestSession,
  renderGoogleButton,
  loadCards,
  onOpenCard,
  createCard,
}: AppProps): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [screen, setScreen] = useState<Screen>('deck');

  if (isSessionValid(session, now)) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>ПЛАН</h1>
        {screen === 'create' ? (
          <CreateCardForm
            onCreate={async (input) => {
              await createCard(input);
              setScreen('deck');
            }}
            onCancel={() => setScreen('deck')}
          />
        ) : (
          <DeckScreen
            loadCards={loadCards}
            onOpenCard={onOpenCard}
            onCreateCard={() => setScreen('create')}
          />
        )}
      </main>
    );
  }

  return (
    <LoginScreen
      requestSession={requestSession}
      renderGoogleButton={renderGoogleButton}
      onLoginSuccess={(result) => {
        const newSession = { token: result.token, expiresAt: result.expiresAt };
        writeStoredSession(newSession);
        setSession(newSession);
      }}
    />
  );
}
