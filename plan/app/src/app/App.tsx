// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveScreen, DeckScreen } from '../cards/life-area-card';
import type {
  CardBackData,
  CardFaceData,
  CardHealthState,
  CardTrackingMode,
  DeckGridItem,
  EntryViewModel,
  MetricBlockFormValues,
} from '../cards/life-area-card';
import { AnalyticsScreen, DeclarationScreen, LayoutBoard } from '../structure';
import type {
  AnalyticsScreenState,
  CloseCardMetricTransferInput,
  DeclarationScreenState,
  LayoutBoardCloseCardOptions,
  LayoutBoardState,
  LayoutMode,
} from '../structure';
// T29 -- реєстрація агента в app-shell (D-25 "агент -- єдиний канал прямого
// вводу продукту ПЛАН"). Імпортується ЛИШЕ через ../agent's index.ts
// (правило залежностей, plan/app/CLAUDE.md) -- ніколи напряму з agent/ui/.
// D-121 (docs/app-shell.md): ChatPanel (колишній ChatScreen) рендериться
// нижче ЯВНО ПОЗА перемикачем `direction` -- постійна панель, не напрямок.
import { AccountScreen, ChatPanel, LogScreen, RuleSettingsScreen } from '../agent';
import type {
  AccountScreenResource,
  ChatMessage,
  ChatProposal,
  ComposerSendInput,
  LogEntryViewModel,
  OnboardingResult,
  RuleSettingsScreenRule,
  RuleSettingsScreenSaveInput,
  RuleSettingsScreenTargetCard,
  SendMessageResult,
} from '../agent';
import { Button, GearIcon, IconButton, Logo } from '../shared/ui';
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
  /** Завантажує лицьову сторону обраної картки (DeckScreen -> CardFace, ISS-55 stage 2; D-121 прибрав окремий CardDetailScreen). */
  loadCard: (cardId: string) => Promise<CardFaceData>;
  /** Завантажує зворот обраної картки (DeckScreen -> CardBack, ISS-55 stage 2; D-121 прибрав окремий CardDetailScreen). */
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
  /** Видаляє (архівує) блок-метрику обраної картки (DELETE /cards/{id}/metric-blocks/{metricBlockId}, CardBack.onArchiveMetricBlock). */
  archiveMetricBlock: (cardId: string, metricBlockId: string) => Promise<void>;
  /** CH-02 (docs/features/life-area-card/changes.md) -- зберігає режим відстеження обраної картки (PATCH /cards/{id}, CardBack.onUpdateTracking). */
  onUpdateTracking: (cardId: string, input: { trackingMode: CardTrackingMode; healthState: CardHealthState | null }) => Promise<void>;
  /** CH-03 (docs/features/life-area-card/changes.md) -- зберігає перейменування/налаштування блоку-метрики (PATCH /cards/{cardId}/metric-blocks/{metricBlockId}, CardBack.onUpdateMetricBlock). */
  onUpdateMetricBlock: (cardId: string, metricBlockId: string, values: MetricBlockFormValues) => Promise<void>;
  /** CH-03 -- переносить блок-метрику на іншу картку (наявний POST .../metric-blocks/transfer, CardBack.onTransferMetricBlock). */
  onTransferMetricBlock: (cardId: string, metricBlockId: string, targetCardId: string) => Promise<void>;
  /** Review C10 (AC-03) -- зберігає Опис/markFilled обраної картки (PATCH /cards/{id}, CardFace.onUpdateDescription). */
  onUpdateDescription: (cardId: string, input: { description: string; markFilled: boolean }) => Promise<void>;
  /** Review 2026-09-07 C11 (AC-12) -- позначає запис в історії обраної картки помилковим (PATCH /entries/{id}, CardBack.onFlagEntry) і повертає свіжий зворот. */
  onFlagEntry: (cardId: string, entryId: string) => Promise<CardBackData>;
  /** T24 (sad.md §5, GET /api/v1/structure -- DeclarationScreen.loadStructure). */
  loadStructure: () => Promise<DeclarationScreenState>;
  /**
   * T24 (sad.md §5, PATCH /api/v1/structure) -- ЧАСТКОВИЙ вхід (обидва поля
   * опційні, бекенд і так приймає PATCH-семантику, structure-handlers.ts
   * StructureUpdateBody). Живе тестування (Андрій): "Налаштування розкладки
   * схеми переносимо в сторінку схеми" -- один реальний виклик (main.tsx),
   * два DI-споживачі: DeclarationScreen.onSave передає лише `declaration`,
   * LayoutBoard.onSaveLayoutMode (нижче) передає лише `layoutMode` -- той
   * самий проп, структурно сумісний з обома вужчими сигнатурами.
   */
  onSaveDeclaration: (input: { declaration?: string; layoutMode?: LayoutMode }) => Promise<void>;
  /** T24 (sad.md §5, GET /api/v1/structure/layout + /connections -- LayoutBoard.loadLayout). */
  loadLayout: () => Promise<LayoutBoardState>;
  /** T24 (sad.md §5, PUT /api/v1/structure/layout/{cardId} -- LayoutBoard.onMoveCard). D-131-наступне рішення: вільне полотно, x/y відсоток канви (0-100) замість cellIndex. */
  onMoveCard: (input: { cardId: string; x: number; y: number }) => Promise<void>;
  /** Вимоги 4/5 (чат): POST /api/v1/structure/connections -- інструмент "Зв'язати" (LayoutBoard.onCreateConnection). */
  onCreateConnection: (input: { cardIdA: string; cardIdB: string; directed: boolean }) => Promise<void>;
  /** Вимога 4 (чат): DELETE /api/v1/structure/connections/{connectionId} -- розірвати зв'язок (LayoutBoard.onDeleteConnection). */
  onDeleteConnection: (input: { connectionId: string }) => Promise<void>;
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
  /** GET /api/v1/messages (ChatPanel.loadHistory). */
  loadChatHistory: () => Promise<ChatMessage[]>;
  /** GET /api/v1/onboarding (ChatPanel.loadOnboarding, AC-13). */
  loadChatOnboarding: () => Promise<OnboardingResult>;
  /** GET /api/v1/proposals/active (ChatPanel.loadActiveProposal). */
  loadActiveChatProposal: () => Promise<ChatProposal | null>;
  /** POST /api/v1/messages (ChatPanel.sendMessage, AC-01/AC-10/AC-19). */
  sendChatMessage: (input: ComposerSendInput) => Promise<SendMessageResult>;
  /** POST /api/v1/proposals/{id}/confirm (ChatPanel.confirmProposal, AC-02). */
  confirmChatProposal: (proposalId: string) => Promise<void>;
  /** GET /api/v1/cards, звужений до {cardId,cardTitle} (RuleSettingsScreen.targetCards, AC-12). */
  loadRuleTargetCards: () => Promise<RuleSettingsScreenTargetCard[]>;
  /** GET /api/v1/rules (RuleSettingsScreen.loadRules, AC-08). */
  loadRules: (scopeCardId: string | null) => Promise<RuleSettingsScreenRule[]>;
  /** POST /api/v1/rules (RuleSettingsScreen.onSave, AC-07/AC-08/AC-12/AC-14). */
  onSaveRule: (input: RuleSettingsScreenSaveInput) => Promise<RuleSettingsScreenRule>;
  /**
   * GET /api/v1/action-log (LogScreen.loadActionLog) -- "Лог дій", заміна
   * ReportsScreen.loadReports/AC-11 у навігації (Андрій: "тупо пишемо кожну
   * дію -- час, дія, все."). Backend-механізм періодичних звітів (GET
   * /reports, agent-worker, D-70) лишається як є, просто без UI-виклику.
   */
  loadActionLog: () => Promise<LogEntryViewModel[]>;
  /** GET /api/v1/sync-resources (AccountScreen.loadResources, AC-18). */
  loadSyncResources: () => Promise<AccountScreenResource[]>;
  /** POST /api/v1/sync-resources (AccountScreen.onAddResource, AC-18). */
  onAddSyncResource: (url: string) => Promise<AccountScreenResource>;
  /** DELETE /api/v1/sync-resources/{id} (AccountScreen.onRemoveResource). */
  onRemoveSyncResource: (resourceId: string) => Promise<void>;
  /** DELETE /api/v1/account (AccountScreen.onDeleteAccount, AC-17/AC-17b). */
  onDeleteAccount: (confirmed: boolean) => Promise<void>;
}

// D-121 (живе тестування): 'detail' прибрано -- відкриття картки окремим
// екраном скасоване, передня картка в DeckScreen/DeckGrid сама несе повний
// вміст (CardFace/CardBack) на місці. CardDetailScreen.tsx видалено.
//
// Задача 13: варіант 'archive' носить `from` -- напрямок (Direction), з
// якого користувач відкрив архів, щоб кнопка "Назад" повертала саме туди
// (а не завжди на 'cards' / екран Картки, як було). CH-01 (structure +
// life-area-card, docs/features/structure/changes.md,
// docs/features/life-area-card/changes.md): тепер ДВА входи в архів --
// LayoutBoard.onOpenArchive ('layout', кнопка "Архів карток" на Схемі) і
// DeckScreen.onOpenArchive ('cards', той самий підпис на Картках) -- поле й
// далі типізоване як Direction, а не буквальний літерал, тож "Назад" сам
// повертає туди, звідки реально прийшли, без додаткової гілки коду.
// CH-04 (docs/features/life-area-card/changes.md): 'create' прибрано --
// створення картки більше не окремий Screen App.tsx перемикає, а inline
// стан усередині самого DeckScreen (renderFront, синтетичний item на місці
// передньої картки колоди) -- App.tsx лише прокидає реальне createCard
// напряму як DeckScreen.onCreateCard, той самий DI-стиль, що onRename/onArchive.
type Screen = { screen: 'deck' } | { screen: 'archive'; from: Direction };

// T24 (sad.md §5 "Навігація (чотири напрямки)") + T29 (агент, D-25 "єдиний
// канал прямого вводу"): постійне нижнє нав-меню, незалежне від Screen
// (Screen лишається під-навігацією "Картки" -- deck/create/archive, D-122
// прибрав 'detail' -- той самий стан переживає перехід на інший напрямок і
// назад -- тест "клік Картки повертає на DeckScreen"). Три напрямки --
// Налаштування правил/Лог дій/Обліковий запис і дані -- один екран
// кожен, без власної під-навігації (на відміну від "cards"); D-123 переніс
// доступ до них із нав-меню в меню шестерні верхнього бару, самі напрямки
// (Direction) не змінились -- лише ЗВІДКИ до них можна дійти.
//
// D-121 (docs/app-shell.md): "agent-chat" ТУТ БІЛЬШЕ НЕМАЄ -- Чат перестав
// бути напрямком контентної зони, тепер постійна ChatPanel нижче, видима на
// всіх напрямках одночасно. D-123: ще 3 напрямки прибрано з рівного списку
// нижнього нав-меню (переїхали під шестерню) -- перший крок ієрархії,
// решта (4 напрямки нижче) досі рівний список без пріоритету, ISS-117
// лишається відкритим не повністю закритим цим комітом.
type Direction = 'cards' | 'declaration' | 'layout' | 'analytics' | 'agent-rules' | 'agent-log' | 'agent-account';

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
  archiveMetricBlock,
  onUpdateTracking,
  onUpdateMetricBlock,
  onTransferMetricBlock,
  onUpdateDescription,
  onFlagEntry,
  loadStructure,
  onSaveDeclaration,
  loadLayout,
  onMoveCard,
  onCreateConnection,
  onDeleteConnection,
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
  loadActionLog,
  loadSyncResources,
  onAddSyncResource,
  onRemoveSyncResource,
  onDeleteAccount,
}: AppProps): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [screen, setScreen] = useState<Screen>({ screen: 'deck' });
  // D-121 (docs/app-shell.md) замінює T29 DoD ("App boots with Чат as the
  // default screen"): Чат більше не "напрямок" контентної зони -- він
  // постійна ChatPanel, видима одночасно з БУДЬ-яким напрямком (нижче), тож
  // сама ідея "дефолтний напрямок = агент" (D-25) тепер задоволена сильніше
  // (завжди на екрані, не лише як стартовий) без потреби займати контентну
  // зону при вході. Дефолт контентної зони -- Картки (найбільш змістовний
  // напрямок за замовчуванням).
  const [direction, setDirection] = useState<Direction>('cards');
  // Живе тестування (Андрій): "Звіти зникають при перемиканні" -- цей стан
  // раніше жив усередині AnalyticsScreen (useState), тож розмонтування при
  // переході на інший напрямок його стирало. Піднято сюди -- та сама
  // причина, що screen/direction тримаються в App, а не в конкретному
  // екрані: пережити перемикання екранів. Найновіший запис -- ПЕРШИЙ
  // (AnalyticsScreen.tsx показує його зверху, скролить туди при появі).
  const [analyticsReportEntries, setAnalyticsReportEntries] = useState<string[]>([]);
  // Живе тестування (Андрій, перевірка порядку): однаковий текст "звіт за
  // запитом" на кожному записі унеможливлював переконатись оком, який саме
  // запис свіжіший -- лічильник (з 1) робить записи розрізненими без вигадки
  // реальних даних (Андрій ще опише справжню логіку звіту пізніше).
  const analyticsReportCountRef = useRef(0);
  // D-123 (живе тестування): меню налаштувань у верхньому барі -- три
  // напрямки (agent-rules/agent-account/agent-log), що ISS-117 називав
  // "другорядними", переїхали з рівного нижнього нав-меню сюди, під значок
  // шестерні. Той самий локальний toggle-стан, що CardFace.tsx's isMenuOpen
  // (меню "..."). Клік по шестерні знову або вибір пункту закривають меню, як
  // і раніше -- ДОДАНО (задача 9): клік будь-де поза меню й поза самою
  // шестернею теж закриває його (стандартна поведінка випадного меню, refs +
  // useEffect нижче), а не лише ці два способи.
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLDivElement>(null);
  const [ruleTargetCards, setRuleTargetCards] = useState<RuleSettingsScreenTargetCard[]>([]);

  // Задача 9: click-outside-close для меню налаштувань -- слухач вішається
  // лише поки меню відкрите (і знімається одразу, щойно закрилось чи
  // компонент розмонтувався), щоб не тримати зайвий global listener весь
  // час. `mousedown`, не `click` -- стандартний вибір для click-outside:
  // спрацьовує до можливого `click` на елементі під курсором. Дві окремі
  // ref -- на сам контейнер меню і окремо на кнопку-шестерню -- бо клік по
  // шестерні, коли меню вже відкрите, має пройти через свій onClick
  // (toggle -> закриє меню), а не крізь цей listener теж (інакше подвійний
  // тригер: закриє й одразу відкриє назад).
  useEffect(() => {
    if (!isSettingsMenuOpen) return;
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target as Node;
      if (settingsMenuRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setIsSettingsMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSettingsMenuOpen]);

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

  // D-121 (живе тестування): Review 2026-09-07 E's "loadCard/loadBack
  // референційна стабільність" фікс переїхав разом із композицією -- App.tsx
  // більше не прив'язує loadCard/loadBack до жодного cardId сам (не було
  // жодного окремого "екрана деталей" з одним обраним screen.cardId).
  // DeckScreen/DeckFrontCard.tsx тепер самі відповідають за useCallback,
  // ключ -- cardId ПЕРЕДНЬОЇ картки колоди (там і напис "той самий контракт").

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

  // CH-01 (structure + life-area-card, docs/features/structure/changes.md,
  // docs/features/life-area-card/changes.md): "Архів карток" тепер живе на
  // ДВОХ екранах (Схема, Картки) замість колишньої єдиної кнопки "Архів" на
  // Аналітиці (D-124). Обидві кнопки мають вести до ОДНІЄЇ й тієї самої
  // поведінки -- єдиний callback тут, на рівні app-composition (plan/app/
  // CLAUDE.md "Правило залежностей": app склеює, фічі -- ні), а не окрема
  // копія логіки в LayoutBoard і DeckScreen.
  const openArchive = useCallback((from: Direction) => {
    setDirection('cards');
    setScreen({ screen: 'archive', from });
  }, []);

  if (isSessionValid(session, now)) {
    return (
      // D-120: слайд-каркас застосунку -- тонка титульна смуга (бренд-назва)
      // зверху, скролований контент по центру, постійне нижнє нав-меню знизу
      // (T24, коментар нижче) -- flex-колонка на всю висоту viewport (dvh, не
      // vh -- враховує мобільні адресні панелі), а не `position: fixed`, щоб
      // нав-меню ніколи не перекривало контент, скільки б рядків воно не
      // зайняло при переносі (flex-wrap) на вузькому екрані.
      //
      // D-121 фікс: `h-dvh` (фіксована висота), не лише `min-h-dvh` --
      // раніше main МІГ вирости вище за viewport на довгому вмісті (список
      // карток тощо), і тоді скролилась уся сторінка разом із шапкою/нав-меню/
      // чат-панеллю -- саме те, чого "прикріплений бар" не повинен робити.
      // `h-dvh` жорстко стелить висоту viewport; `min-h-0` на контентному div
      // (нижче) -- обов'язкова пара до grid-рядка: без нього grid-дитина не
      // стискається нижче висоти свого вмісту, і `overflow-y-auto` просто
      // ніколи не спрацьовує (та сама пастка, що у flexbox).
      //
      // D-121 (широкий екран, живе тестування, уточнено): CSS Grid, не
      // flex-колонка -- на мобільному 1 колонка/4 рядки (шапка/контент/нав/
      // чат), на md+ 2 колонки (чат 20% зліва | шапка+контент справа) і 3
      // рядки. Чат-колонка -- на всю висоту (row-span-3, ChatPanel.tsx), нав
      // -- лише під шапкою+контентом (колонка 2, row-start-3), НЕ заходить
      // під чат: межа між колонками лишається рівною лінією зверху донизу,
      // а не переривається нав-рядком знизу-зліва. Один і той самий набір
      // елементів (DOM не дублюється) -- лише явне розміщення
      // (`md:col-start-*`/`md:row-start-*`/`md:row-span-*`) міняє їхнє місце
      // в сітці залежно від брейкпоінта; на мобільному спрацьовує звичайний
      // порядок DOM (auto-placement), явних класів там не треба.
      // D-121 (живе тестування -- тягти мишкою праву межу чату): ширина лівої
      // колонки -- CSS-змінна `--chat-width` (дефолт 25%, `var(..., 25%)`
      // всередині arbitrary-класу нижче), не хардкод. ChatPanel.tsx сам пише
      // в цю змінну на document.documentElement під час перетягування
      // хендла -- пряма мутація DOM в обхід React-стану, свідомо (кожен
      // mousemove передзвонював би useState -> зайвий re-render усього
      // App.tsx на кожен піксель руху миші; CSS-змінна оновлюється браузером
      // без React узагалі). Фолбек `20%` спрацьовує сам, поки не було жодного
      // перетягування -- ініціалізувати змінну на монтуванні не треба.
      <main className="grid h-dvh grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-bg font-sans text-ink md:grid-cols-[var(--chat-width,25%)_1fr] md:grid-rows-[auto_minmax(0,1fr)_auto]">
        {/* D-123 (живе тестування): шестерня -- ЛИШЕ значок, без підпису
            "Налаштування" (Андрій: "не пишемо в ній налаштування, а просто
            шестерню"), у верхньому пінned барі справа. Клік розгортає меню
            (role="menu", той самий патерн, що CardFace.tsx's "..."): три
            пункти, що раніше стояли рівноправно в нижньому нав-меню. */}
        <div className="relative flex items-center justify-between border-b border-border bg-surface-solid px-4 py-3 sm:px-6 md:col-start-2 md:row-start-1">
          {/* Задача 20: невеликий Logo (shared/ui/Logo.tsx, раніше лише
              h-48 w-48 на LoginScreen) поруч із написом "ПЛАН" -- розмір
              h-6 w-6 підібраний за аналогією з GearIcon нижче (h-5 w-5
              всередині h-9 w-9 кнопки): трохи більший за значок шестерні,
              бо це лого, але явно менший за повнорозмірний варіант входу. */}
          <h1 className="flex items-center gap-2 font-display text-lg font-bold leading-relaxed tracking-tight text-ink">
            <Logo className="h-6 w-6 text-ink" />
            ПЛАН
          </h1>
          {/* D-124 (живе тестування): "Вийти" переїхало сюди з Колоди
              (life-area-card/DeckScreen.tsx) -- "поруч із шестернею, справа,
              зверху в прикріпленому барі". Шестерня лишається крайньою
              справа (та сама позиція, що D-123 уже закріпив), "Вийти" -- її
              безпосередній сусід зліва в тому самому кластері. */}
          <div className="flex items-center gap-2">
            <Button label="Вийти" onClick={endSession} />
            {/* D-123 (живе тестування): "виділи як кнопку" -- рамка/фон завжди
                видимі, не лише на hover (дефолт IconButton -- прозорий у стані
                спокою, тут цього замало: значок сам-один у шапці губився). */}
            {/* `contents` -- div існує лише як носій ref для click-outside
                (задача 9), не бере участі в flex-розкладці навколо (той
                самий layout, що й до цього блоку). */}
            <div ref={settingsButtonRef} className="contents">
              <IconButton
                label={isSettingsMenuOpen ? 'Закрити меню налаштувань' : 'Меню налаштувань'}
                onClick={() => setIsSettingsMenuOpen((prev) => !prev)}
                className="border border-border bg-surface"
              >
                <GearIcon className="h-5 w-5" />
              </IconButton>
            </div>
          </div>
          {isSettingsMenuOpen && (
            <div
              ref={settingsMenuRef}
              role="menu"
              className="absolute right-4 top-full z-10 mt-1 flex w-56 flex-col gap-0.5 rounded-control border border-border bg-surface-solid p-1.5 shadow-soft sm:right-6"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDirection('agent-rules');
                  setIsSettingsMenuOpen(false);
                }}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
              >
                Налаштування правил
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDirection('agent-account');
                  setIsSettingsMenuOpen(false);
                }}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
              >
                Обліковий запис і дані
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDirection('agent-log');
                  setIsSettingsMenuOpen(false);
                }}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
              >
                Лог дій
              </button>
            </div>
          )}
        </div>

        {/* D-125 (живе тестування): py-3 (не py-4) -- узгоджено з <nav>'s
            власним py-3 нижче ("усе пропорційно": відступ контентної зони
            від сусідніх панелей дорівнює власному внутрішньому відступу
            панелей від їхніх кнопок, та сама одиниця виміру скрізь). */}
        <div className="min-h-0 overflow-y-auto px-4 py-3 sm:px-6 md:col-start-2 md:row-start-2">
          {direction === 'declaration' && <DeclarationScreen loadStructure={loadStructure} onSave={onSaveDeclaration} />}
          {direction === 'layout' && (
            <LayoutBoard
              loadLayout={loadLayout}
              onMoveCard={onMoveCard}
              onCreateConnection={onCreateConnection}
              onDeleteConnection={onDeleteConnection}
              // Живе тестування (Андрій): "Конфігурація" зберігає layoutMode --
              // той самий реальний PATCH /api/v1/structure, що DeclarationScreen
              // нижче використовує для declaration (одне DI-джерело onSaveDeclaration,
              // структурно сумісне з обома вужчими сигнатурами -- AppProps коментар вище).
              onSaveLayoutMode={onSaveDeclaration}
              loadCloseCardOptions={loadCloseCardOptions}
              onCloseCard={onCloseCard}
              // CH-01 (structure): "Архів карток" біля "Конфігурація" --
              // openArchive вище, той самий shared callback, що DeckScreen
              // нижче отримує для свого дубля кнопки.
              onOpenArchive={() => openArchive('layout')}
            />
          )}
          {direction === 'analytics' && (
            <AnalyticsScreen
              loadAnalytics={loadAnalytics}
              reportEntries={analyticsReportEntries}
              onAddReportEntry={() => {
                analyticsReportCountRef.current += 1;
                setAnalyticsReportEntries((prev) => [`звіт за запитом №${analyticsReportCountRef.current}`, ...prev]);
              }}
            />
          )}

          {direction === 'agent-rules' && (
            <RuleSettingsScreen targetCards={ruleTargetCards} loadRules={loadRules} onSave={onSaveRule} />
          )}
          {direction === 'agent-log' && <LogScreen loadActionLog={loadActionLog} />}
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

          {direction === 'cards' && screen.screen === 'archive' && (
            // Живе тестування (Андрій): "Назад" -- плаваюча, знизу справа,
            // поверх контенту (той самий патерн, що плаваюча "Звіт" на
            // AnalyticsScreen.tsx) -- не суцільна смуга зверху, як було.
            <div className="relative flex h-full min-h-0 flex-col">
              <ArchiveScreen
                loadArchivedCards={loadArchivedCards}
                onRestoreCard={onRestoreCard}
                loadArchivedCardHistory={loadArchivedCardHistory}
              />
              <div className="absolute bottom-4 right-4 z-20">
                <Button
                  label="← Назад"
                  onClick={() => {
                    // Задача 13: повертаємось туди, звідки відкрили архів
                    // (screen.from -- CH-01: 'layout' зі Схеми чи 'cards' з
                    // Карток, openArchive вище), не завжди на 'cards' --
                    // раніше цей клік вів на Картки навіть коли користувач
                    // прийшов з іншого напрямку, бо direction лишався 'cards'
                    // з моменту відкриття архіву.
                    setDirection(screen.from);
                    setScreen({ screen: 'deck' });
                  }}
                />
              </div>
            </div>
          )}
          {direction === 'cards' && screen.screen === 'deck' && (
            <DeckScreen
              loadCards={loadCards}
              // CH-04: реальне createCard напряму -- DeckScreen сам показує
              // inline CreateCardForm (renderFront) і викликає цей проп лише
              // з її onSubmit, той самий DI-стиль, що onRename/archiveCard.
              onCreateCard={createCard}
              // D-124 (живе тестування, історичний крок): "Вийти" прибрано
              // звідси -- переїхало у верхній бар (поруч із шестернею).
              // "Архів карток" ЛИШАЄТЬСЯ/ПОВЕРТАЄТЬСЯ сюди -- CH-01
              // (onOpenArchive нижче), не D-124 (та стара кнопка вела на
              // Аналітику й давно прибрана звідти).
              //
              // Review 2026-09-07 C14 (AC-04): 401 при завантаженні колоди --
              // той самий шлях, що ручний "Вийти" (сесія все одно недійсна,
              // тримати її в сховищі означає знову впертись у 401 наступного
              // разу).
              onSessionExpired={endSession}
              // D-121 (живе тестування): ті самі cardId-параметризовані
              // AppProps, що раніше йшли лише в окремий CardDetailScreen
              // (прибраний), тепер прокидаються прямо сюди без обгортання --
              // DeckScreen/DeckFrontCard самі в'яжуть їх до передньої картки.
              loadCard={loadCard}
              loadBack={loadBack}
              onRename={onRename}
              onArchive={archiveCard}
              onUpdateDescription={onUpdateDescription}
              onFlagEntry={onFlagEntry}
              onCreateMetricBlock={createMetricBlock}
              onArchiveMetricBlock={archiveMetricBlock}
              onUpdateTracking={onUpdateTracking}
              onUpdateMetricBlock={onUpdateMetricBlock}
              onTransferMetricBlock={onTransferMetricBlock}
              // CH-01 (life-area-card): дубль кнопки "Архів карток" біля
              // "Створити картку" -- той самий shared callback, що LayoutBoard
              // вище отримує для своєї кнопки; обидві ведуть в те саме місце.
              onOpenArchive={() => openArchive('cards')}
            />
          )}
        </div>

        {/* T24 (sad.md §5): постійне нижнє нав-меню -- видиме на всіх
            напрямках, не лише на "Картки". "Картки" ЗАВЖДИ повертає на
            deck-екран (скидає під-навігацію create/archive) -- коментар до
            самої кнопки "Картки" нижче пояснює чому (раніше лише перемикало
            direction, це виглядало як баг: клік із Архіву повертав в Архів
            замість Колоди).
            D-111: усі пункти -- одного класу дії (навігація між напрямками)
            -- лишаються згруповані в одному <nav>, тепер з переносом рядків
            (flex-wrap), щоб на вузькому екрані (~360-400px) вони НЕ виходили
            за межі екрана й не змушували сторінку скролитись горизонтально.
            D-121: "Чат" звідси прибрано -- він більше не напрямок (ChatPanel
            нижче, поза цим <nav>). D-123 (живе тестування): ще 3 пункти
            (Налаштування правил/Лог дій/Обліковий запис і дані)
            переїхали в меню шестерні верхнього бару -- перший крок ієрархії,
            яку ISS-117 називав відкритою (не закриває питання повністю: 4
            пункти нижче лишаються рівним списком, який ще потребує
            власного рішення про пріоритет).
            D-121 (широкий екран, живе тестування -- уточнено): нав на md+
            стоїть ЛИШЕ під шапкою+контентом (колонка 2) -- чат-бічка (колонка
            1) тягнеться на всю висоту екрана (ChatPanel.tsx `row-span-3`) і
            нав під неї не заходить, межа лишається рівною вертикальною лінією
            зверху донизу. На мобільному (де бічки взагалі нема) нав і так на
            всю ширину -- "той самий бар для обох версій" виконується тим, що
            це один код без дублювання, а не тим, що нав завжди на всю ширину
            фізично. */}
        <nav className="flex flex-wrap justify-center gap-2 border-t border-border bg-surface-solid px-3 py-3 sm:gap-3 sm:px-4 md:col-start-2 md:row-start-3">
          <Button label="Декларація" onClick={() => setDirection('declaration')} />
          <Button label="Схема" onClick={() => setDirection('layout')} />
          {/* D-125 (живе тестування): "Літопис-Аналітика" -> "Аналітика" --
              коротший підпис, той самий напрямок ('analytics') і той самий
              AnalyticsScreen під ним, назва напрямку в коді не змінилась. */}
          <Button label="Аналітика" onClick={() => setDirection('analytics')} />
          {/* Живе тестування (Андрій): "Картки" тепер ЗАВЖДИ веде на саму
              колоду, навіть якщо перед цим був відкритий архів чи форма
              створення -- раніше кнопка лише перемикала direction, а Screen
              лишався як був (навмисно, D-111 вище), тому клік із Архіву
              повертав в Архів замість Колоди -- це виглядало як баг, не як
              "запам'ятало місце". */}
          <Button
            label="Картки"
            onClick={() => {
              setDirection('cards');
              setScreen({ screen: 'deck' });
            }}
          />
        </nav>

        {/* D-121 (docs/app-shell.md): чат-панель -- ПОСТІЙНА, поза перемикачем
            `direction` вище, видима на всіх 7 напрямках одночасно (не лише
            "Картки"). Композер завжди на екрані; сама переписка розгортається
            на 30vh лише коли користувач сам натисне хендл (ChatPanel.tsx).
            На широкому екрані (md+) ChatPanel сам перемикається на лівий
            бічний стовпчик 20% на всю висоту шапки+контенту -- власна
            grid-розстановка й приховування хендла-тумблера всередині
            ChatPanel.tsx, тут виклик не змінюється. */}
        <ChatPanel
          loadHistory={loadChatHistory}
          loadOnboarding={loadChatOnboarding}
          loadActiveProposal={loadActiveChatProposal}
          sendMessage={sendChatMessage}
          confirmProposal={confirmChatProposal}
        />
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
