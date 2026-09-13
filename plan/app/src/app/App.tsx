// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useCallback, useEffect, useState } from 'react';
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
// T29 -- реєстрація агента в app-shell (D-25 "агент -- єдиний канал прямого
// вводу продукту ПЛАН"). Імпортується ЛИШЕ через ../agent's index.ts
// (правило залежностей, plan/app/CLAUDE.md) -- ніколи напряму з agent/ui/.
import { AccountScreen, ChatScreen, ReportsScreen, RuleSettingsScreen } from '../agent';
import type {
  AccountScreenResource,
  ChatMessage,
  ChatProposal,
  ComposerSendInput,
  OnboardingResult,
  ReportViewModel,
  RuleSettingsScreenRule,
  RuleSettingsScreenSaveInput,
  RuleSettingsScreenTargetCard,
  SendMessageResult,
} from '../agent';
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

  // --- Агент (T29, contracts/openapi.yaml) -------------------------------
  /** GET /api/v1/messages (ChatScreen.loadHistory). */
  loadChatHistory: () => Promise<ChatMessage[]>;
  /** GET /api/v1/onboarding (ChatScreen.loadOnboarding, AC-13). */
  loadChatOnboarding: () => Promise<OnboardingResult>;
  /** GET /api/v1/proposals/active (ChatScreen.loadActiveProposal). */
  loadActiveChatProposal: () => Promise<ChatProposal | null>;
  /** POST /api/v1/messages (ChatScreen.sendMessage, AC-01/AC-10/AC-19). */
  sendChatMessage: (input: ComposerSendInput) => Promise<SendMessageResult>;
  /** POST /api/v1/proposals/{id}/confirm (ChatScreen.confirmProposal, AC-02). */
  confirmChatProposal: (proposalId: string) => Promise<void>;
  /** GET /api/v1/cards, звужений до {cardId,cardTitle} (RuleSettingsScreen.targetCards, AC-12). */
  loadRuleTargetCards: () => Promise<RuleSettingsScreenTargetCard[]>;
  /** GET /api/v1/rules (RuleSettingsScreen.loadRules, AC-08). */
  loadRules: (scopeCardId: string | null) => Promise<RuleSettingsScreenRule[]>;
  /** POST /api/v1/rules (RuleSettingsScreen.onSave, AC-07/AC-08/AC-12/AC-14). */
  onSaveRule: (input: RuleSettingsScreenSaveInput) => Promise<RuleSettingsScreenRule>;
  /** GET /api/v1/reports (ReportsScreen.loadReports, AC-11). */
  loadReports: () => Promise<ReportViewModel[]>;
  /** GET /api/v1/sync-resources (AccountScreen.loadResources, AC-18). */
  loadSyncResources: () => Promise<AccountScreenResource[]>;
  /** POST /api/v1/sync-resources (AccountScreen.onAddResource, AC-18). */
  onAddSyncResource: (url: string) => Promise<AccountScreenResource>;
  /** DELETE /api/v1/sync-resources/{id} (AccountScreen.onRemoveResource). */
  onRemoveSyncResource: (resourceId: string) => Promise<void>;
  /** DELETE /api/v1/account (AccountScreen.onDeleteAccount, AC-17/AC-17b). */
  onDeleteAccount: (confirmed: boolean) => Promise<void>;
}

type Screen = { screen: 'deck' } | { screen: 'create' } | { screen: 'detail'; cardId: string } | { screen: 'archive' };

// T24 (sad.md §5 "Навігація (чотири напрямки)") + T29 (агент, D-25 "єдиний
// канал прямого вводу"): постійне нижнє нав-меню, незалежне від Screen
// (Screen лишається під-навігацією "Картки" -- deck/create/detail/archive,
// той самий стан переживає перехід на інший напрямок і назад -- тест "клік
// Картки повертає на DeckScreen"). Чотири нові напрямки -- Чат/Налаштування
// правил/Звіти активності/Обліковий запис і дані -- один екран кожен, без
// власної під-навігації (на відміну від "cards").
type Direction = 'cards' | 'declaration' | 'layout' | 'analytics' | 'agent-chat' | 'agent-rules' | 'agent-reports' | 'agent-account';

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
  onUpdateDescription,
  onFlagEntry,
  loadStructure,
  onSaveDeclaration,
  loadLayout,
  onMoveCard,
  loadAnalytics,
  loadCloseCardOptions,
  onCloseCard,
  loadChatHistory,
  loadChatOnboarding,
  loadActiveChatProposal,
  sendChatMessage,
  confirmChatProposal,
  loadRuleTargetCards,
  loadRules,
  onSaveRule,
  loadReports,
  loadSyncResources,
  onAddSyncResource,
  onRemoveSyncResource,
  onDeleteAccount,
}: AppProps): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [screen, setScreen] = useState<Screen>({ screen: 'deck' });
  // T29 DoD ("App boots with Чат as the default screen") -- D-25 "агент --
  // єдиний канал прямого вводу продукту ПЛАН": Чат замінює Картки як перший
  // екран, що бачить щойно увійшовший користувач. Картки й решта напрямків
  // лишаються рівноправно досяжні з нав-меню нижче, лише більше не дефолтні.
  const [direction, setDirection] = useState<Direction>('agent-chat');
  const [ruleTargetCards, setRuleTargetCards] = useState<RuleSettingsScreenTargetCard[]>([]);

  // AC-12 (RuleSettingsScreen card-override): картки завантажуються лише
  // коли користувач реально відкрив цей напрямок, не одразу при вході (той
  // самий "лінивий" підхід, що LayoutBoard.loadCloseCardOptions -- жодного
  // зайвого GET /cards, поки правила ніхто не налаштовує).
  useEffect(() => {
    if (direction !== 'agent-rules') return;
    let cancelled = false;
    loadRuleTargetCards().then((cards) => {
      if (!cancelled) setRuleTargetCards(cards);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

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
      // D-120: слайд-каркас застосунку -- тонка титульна смуга (бренд-назва)
      // зверху, скролований контент по центру, постійне нижнє нав-меню знизу
      // (T24, коментар нижче) -- flex-колонка на всю висоту viewport (dvh, не
      // vh -- враховує мобільні адресні панелі), а не `position: fixed`, щоб
      // нав-меню ніколи не перекривало контент, скільки б рядків воно не
      // зайняло при переносі (flex-wrap) на вузькому екрані.
      <main className="flex min-h-dvh flex-col bg-bg font-sans text-ink">
        <h1 className="border-b border-border bg-surface-solid px-4 py-3 font-display text-lg font-bold tracking-tight text-ink sm:px-6">
          ПЛАН
        </h1>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
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

          {direction === 'agent-chat' && (
            <ChatScreen
              loadHistory={loadChatHistory}
              loadOnboarding={loadChatOnboarding}
              loadActiveProposal={loadActiveChatProposal}
              sendMessage={sendChatMessage}
              confirmProposal={confirmChatProposal}
            />
          )}
          {direction === 'agent-rules' && (
            <RuleSettingsScreen targetCards={ruleTargetCards} loadRules={loadRules} onSave={onSaveRule} />
          )}
          {direction === 'agent-reports' && <ReportsScreen loadReports={loadReports} />}
          {direction === 'agent-account' && (
            <AccountScreen
              loadResources={loadSyncResources}
              onAddResource={onAddSyncResource}
              onRemoveResource={onRemoveSyncResource}
              onDeleteAccount={onDeleteAccount}
              // AC-17: акаунт видалено -> сесія завершена, повернення на екран
              // входу -- той самий endSession, що кнопка "Вийти" вже використовує.
              onDeleted={endSession}
            />
          )}

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
              onUpdateDescription={(input) => onUpdateDescription(screen.cardId, input)}
              onFlagEntry={(entryId) => onFlagEntry(screen.cardId, entryId)}
            />
          )}
          {direction === 'cards' && screen.screen === 'archive' && (
            <div className="flex flex-col gap-4">
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
        </div>

        {/* T24 (sad.md §5): постійне нижнє нав-меню -- видиме на всіх 4
            напрямках, не лише на "Картки". "Картки" не скидає під-навігацію
            create/detail/archive -- лише перемикає direction, Screen
            лишається як був (тест "клік Картки повертає на DeckScreen").
            D-111: усі пункти -- одного класу дії (навігація між напрямками)
            -- лишаються згруповані в одному <nav>, тепер з переносом рядків
            (flex-wrap), щоб на вузькому екрані (~360-400px) вони НЕ виходили
            за межі екрана й не змушували сторінку скролитись горизонтально. */}
        <nav className="flex flex-wrap justify-center gap-2 border-t border-border bg-surface-solid px-3 py-3 sm:gap-3 sm:px-4">
          <Button label="Чат" onClick={() => setDirection('agent-chat')} />
          <Button label="Налаштування правил" onClick={() => setDirection('agent-rules')} />
          <Button label="Звіти активності" onClick={() => setDirection('agent-reports')} />
          <Button label="Обліковий запис і дані" onClick={() => setDirection('agent-account')} />
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
