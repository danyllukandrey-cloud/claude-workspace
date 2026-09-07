// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useState } from 'react';
import { ArchiveScreen, CardDetailScreen, CreateCardForm, DeckScreen } from '../cards/life-area-card';
import type { CardBackData, CardFaceData, DeckGridItem, EntryViewModel, MetricBlockFormValues } from '../cards/life-area-card';
import { Button } from '../shared/ui';
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
  /** Стирає сесію зі сховища (кнопка "Вийти", ISS-58). */
  clearStoredSession: () => void;
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
  /** Створює нову картку (POST /cards, CreateCardForm.onCreate, ISS-55). */
  createCard: (input: { name: string }) => Promise<void>;
  /** Завантажує лицьову сторону обраної картки (CardDetailScreen.loadCard, ISS-55 stage 2). */
  loadCard: (cardId: string) => Promise<CardFaceData>;
  /** Завантажує зворот обраної картки (CardDetailScreen.loadBack, ISS-55 stage 2). */
  loadBack: (cardId: string) => Promise<CardBackData>;
  /** Зберігає нову назву обраної картки (AC-19, PATCH /cards/{id}, ISS-55 stage 2). */
  onRename: (cardId: string, name: string) => Promise<void>;
  /** Завантажує архівовані картки (ArchiveScreen.loadArchivedCards, ISS-55 stage 3). */
  loadArchivedCards: () => Promise<DeckGridItem[]>;
  /** Розархівовує картку (ArchiveScreen.onRestoreCard, ISS-55 stage 3). */
  onRestoreCard: (cardId: string) => Promise<void>;
  /** Завантажує історію записів архівованої картки (ArchiveScreen.loadArchivedCardHistory, ISS-55 stage 3). */
  loadArchivedCardHistory: (cardId: string) => Promise<EntryViewModel[]>;
  /** Архівовує обрану картку (DELETE /cards/{cardId}, CardFace.onArchive, ISS-56). */
  archiveCard: (cardId: string) => Promise<void>;
  /** Створює блок-метрику обраної картки (POST /cards/{id}/metric-blocks, CardBack.onCreateMetricBlock, ISS-60). */
  createMetricBlock: (cardId: string, values: MetricBlockFormValues) => Promise<void>;
  /** ТИМЧАСОВО (D-110, docs/DECISIONS.md) -- вносить запис для блоку обраної картки (POST .../metric-blocks/{id}/entries, CardBack.onAddEntry). */
  addEntry: (cardId: string, metricBlockId: string, amount: number) => Promise<void>;
  /** Review C10 (AC-03) -- зберігає Опис/markFilled обраної картки (PATCH /cards/{id}, CardFace.onUpdateDescription). */
  onUpdateDescription: (cardId: string, input: { description: string; markFilled: boolean }) => Promise<void>;
}

type Screen = { screen: 'deck' } | { screen: 'create' } | { screen: 'detail'; cardId: string } | { screen: 'archive' };

function isSessionValid(session: StoredSession | null, now: () => Date): boolean {
  if (!session) return false;
  return new Date(session.expiresAt).getTime() > now().getTime();
}

export function App({
  readStoredSession,
  writeStoredSession,
  clearStoredSession,
  now,
  requestSession,
  renderGoogleButton,
  loadCards,
  createCard,
  loadCard,
  loadBack,
  onRename,
  loadArchivedCards,
  onRestoreCard,
  loadArchivedCardHistory,
  archiveCard,
  createMetricBlock,
  addEntry,
  onUpdateDescription,
}: AppProps): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [screen, setScreen] = useState<Screen>({ screen: 'deck' });

  if (isSessionValid(session, now)) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>ПЛАН</h1>
        {screen.screen === 'create' && (
          <CreateCardForm
            onCreate={async (input) => {
              await createCard(input);
              setScreen({ screen: 'deck' });
            }}
            onCancel={() => setScreen({ screen: 'deck' })}
          />
        )}
        {screen.screen === 'detail' && (
          <CardDetailScreen
            loadCard={() => loadCard(screen.cardId)}
            loadBack={() => loadBack(screen.cardId)}
            onRename={(name) => onRename(screen.cardId, name)}
            onBack={() => setScreen({ screen: 'deck' })}
            onArchive={() => archiveCard(screen.cardId)}
            onArchived={() => setScreen({ screen: 'deck' })}
            onCreateMetricBlock={(values) => createMetricBlock(screen.cardId, values)}
            onAddEntry={(metricBlockId, amount) => addEntry(screen.cardId, metricBlockId, amount)}
            onUpdateDescription={(input) => onUpdateDescription(screen.cardId, input)}
          />
        )}
        {screen.screen === 'archive' && (
          <div>
            <Button label="← Назад" onClick={() => setScreen({ screen: 'deck' })} />
            <ArchiveScreen
              loadArchivedCards={loadArchivedCards}
              onRestoreCard={onRestoreCard}
              loadArchivedCardHistory={loadArchivedCardHistory}
            />
          </div>
        )}
        {screen.screen === 'deck' && (
          <DeckScreen
            loadCards={loadCards}
            onOpenCard={(cardId) => setScreen({ screen: 'detail', cardId })}
            onCreateCard={() => setScreen({ screen: 'create' })}
            onOpenArchive={() => setScreen({ screen: 'archive' })}
            onLogout={() => {
              clearStoredSession();
              setSession(null);
            }}
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
