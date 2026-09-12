// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useCallback, useState } from 'react';
import { ArchiveScreen, CardDetailScreen, CreateCardForm, DeckScreen } from '../cards/life-area-card';
import type { CardBackData, CardFaceData, DeckGridItem, EntryViewModel, MetricBlockFormValues } from '../cards/life-area-card';
import { AnalyticsScreen, DeclarationScreen, LayoutBoard } from '../structure';
import type {
  AnalyticsScreenState,
  CloseCardMetricTransferInput,
  DeclarationScreenState,
  LayoutBoardCloseCardOptions,
  LayoutBoardState,
  LayoutMode,
  LogicVariant,
} from '../structure';
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
  /** Review 2026-09-07 C11 (AC-12) -- позначає запис в історії обраної картки помилковим (PATCH /entries/{id}, CardBack.onFlagEntry) і повертає свіжий зворот. */
  onFlagEntry: (cardId: string, entryId: string) => Promise<CardBackData>;
  /** T24 (sad.md §5, GET /api/v1/structure -- DeclarationScreen.loadStructure). */
  loadStructure: () => Promise<DeclarationScreenState>;
  /** T24 (sad.md §5, PATCH /api/v1/structure -- DeclarationScreen.onSave). */
  onSaveDeclaration: (input: { declaration: string; layoutMode: LayoutMode; logicVariant: LogicVariant }) => Promise<void>;
  /** T24 (sad.md §5, GET /api/v1/structure/layout -- LayoutBoard.loadLayout). */
  loadLayout: () => Promise<LayoutBoardState>;
  /** T24 (sad.md §5, PUT /api/v1/structure/layout/{cardId} -- LayoutBoard.onMoveCard). */
  onMoveCard: (input: { cardId: string; cellIndex: number }) => Promise<void>;
  /** T24 (sad.md §5, зведена аналітика -- AnalyticsScreen.loadAnalytics). */
  loadAnalytics: () => Promise<AnalyticsScreenState>;
  /**
   * AC-12 -- GET /api/v1/cards/{cardId}/metric-blocks (LayoutBoard.loadCloseCardOptions).
   * Опційне, як і в LayoutBoard: без нього кнопка "Закрити напрямок" не рендериться
   * (review-fix 2026-09-11 -- до цього фіксу пропс узагалі не доходив до App, тож
   * SCR-04 був написаний і протестований, але недосяжний користувачу).
   */
  loadCloseCardOptions?: (cardId: string) => Promise<LayoutBoardCloseCardOptions>;
  /** AC-12 -- POST /api/v1/structure/layout/{cardId}/close (LayoutBoard.onCloseCard). */
  onCloseCard?: (input: { cardId: string; metricTransfers: CloseCardMetricTransferInput[] }) => Promise<void>;
}

type Screen = { screen: 'deck' } | { screen: 'create' } | { screen: 'detail'; cardId: string } | { screen: 'archive' };

// T24 (sad.md §5 "Навігація (чотири напрямки)"): постійне нижнє нав-меню,
// незалежне від Screen (Screen лишається під-навігацією "Картки" --
// deck/create/detail/archive, той самий стан переживає перехід на інший
// напрямок і назад -- тест "клік Картки повертає на DeckScreen").
type Direction = 'cards' | 'declaration' | 'layout' | 'analytics';

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
  onFlagEntry,
  loadStructure,
  onSaveDeclaration,
  loadLayout,
  onMoveCard,
  loadAnalytics,
  loadCloseCardOptions,
  onCloseCard,
}: AppProps): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [screen, setScreen] = useState<Screen>({ screen: 'deck' });
  const [direction, setDirection] = useState<Direction>('cards');

  // Review 2026-09-07 E (T52): "loadCard/loadBack порушують задокументований
  // контракт референційної стабільності" (той самий контракт, що
  // DeckScreen.loadCards уже документує -- DeckScreen.tsx, "Контракт: має
  // бути референційно стабільною"). Інлайн-лямбди `() => loadCard(screen.cardId)`
  // прямо в JSX перестворювались щорендера App -- CardFace/CardBack
  // перезапускали свій useEffect(..., [loadCard]) на КОЖНУ таку зміну
  // посилання, не лише при реальній навігації на іншу картку. useCallback,
  // ключ -- сам cardId (з'явиться поза 'detail' -- undefined, стабільно).
  const detailCardId = screen.screen === 'detail' ? screen.cardId : undefined;
  const loadCardForDetail = useCallback(() => loadCard(detailCardId as string), [detailCardId, loadCard]);
  const loadBackForDetail = useCallback(() => loadBack(detailCardId as string), [detailCardId, loadBack]);

  // Review 2026-09-07, post-ship follow-up review (E, referential stability):
  // onLogout/onSessionExpired do the exact same thing (clear session, reset
  // state) and were both passed as fresh inline lambdas every App render --
  // onSessionExpired is a dependency of DeckScreen's own load-effect
  // (DeckScreen.tsx useEffect deps), so an unrelated App re-render while the
  // deck screen stayed mounted would re-trigger GET /cards, violating the
  // same referential-stability contract DeckScreen.loadCards already
  // documents (and that loadCardForDetail above was just fixed to honour).
  const endSession = useCallback(() => {
    clearStoredSession();
    setSession(null);
  }, [clearStoredSession]);

  if (isSessionValid(session, now)) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>ПЛАН</h1>

        {direction === 'declaration' && <DeclarationScreen loadStructure={loadStructure} onSave={onSaveDeclaration} />}
        {direction === 'layout' && (
          <LayoutBoard
            loadLayout={loadLayout}
            onMoveCard={onMoveCard}
            loadCloseCardOptions={loadCloseCardOptions}
            onCloseCard={onCloseCard}
          />
        )}
        {direction === 'analytics' && <AnalyticsScreen loadAnalytics={loadAnalytics} />}

        {direction === 'cards' && screen.screen === 'create' && (
          <CreateCardForm
            onCreate={async (input) => {
              await createCard(input);
              setScreen({ screen: 'deck' });
            }}
            onCancel={() => setScreen({ screen: 'deck' })}
          />
        )}
        {direction === 'cards' && screen.screen === 'detail' && (
          <CardDetailScreen
            loadCard={loadCardForDetail}
            loadBack={loadBackForDetail}
            onRename={(name) => onRename(screen.cardId, name)}
            onBack={() => setScreen({ screen: 'deck' })}
            onArchive={() => archiveCard(screen.cardId)}
            onArchived={() => setScreen({ screen: 'deck' })}
            onCreateMetricBlock={(values) => createMetricBlock(screen.cardId, values)}
            onAddEntry={(metricBlockId, amount) => addEntry(screen.cardId, metricBlockId, amount)}
            onUpdateDescription={(input) => onUpdateDescription(screen.cardId, input)}
            onFlagEntry={(entryId) => onFlagEntry(screen.cardId, entryId)}
          />
        )}
        {direction === 'cards' && screen.screen === 'archive' && (
          <div>
            <Button label="← Назад" onClick={() => setScreen({ screen: 'deck' })} />
            <ArchiveScreen
              loadArchivedCards={loadArchivedCards}
              onRestoreCard={onRestoreCard}
              loadArchivedCardHistory={loadArchivedCardHistory}
            />
          </div>
        )}
        {direction === 'cards' && screen.screen === 'deck' && (
          <DeckScreen
            loadCards={loadCards}
            onOpenCard={(cardId) => setScreen({ screen: 'detail', cardId })}
            onCreateCard={() => setScreen({ screen: 'create' })}
            onOpenArchive={() => setScreen({ screen: 'archive' })}
            onLogout={endSession}
            // Review 2026-09-07 C14 (AC-04): 401 при завантаженні колоди --
            // той самий шлях, що ручний "Вийти" (сесія все одно недійсна,
            // тримати її в сховищі означає знову впертись у 401 наступного
            // разу).
            onSessionExpired={endSession}
          />
        )}

        {/* T24 (sad.md §5): постійне нижнє нав-меню -- видиме на всіх 4
            напрямках, не лише на "Картки". "Картки" не скидає під-навігацію
            create/detail/archive -- лише перемикає direction, Screen
            лишається як був (тест "клік Картки повертає на DeckScreen"). */}
        <nav>
          <Button label="Декларація" onClick={() => setDirection('declaration')} />
          <Button label="Схема" onClick={() => setDirection('layout')} />
          <Button label="Літопис-Аналітика" onClick={() => setDirection('analytics')} />
          <Button label="Картки" onClick={() => setDirection('cards')} />
        </nav>
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
