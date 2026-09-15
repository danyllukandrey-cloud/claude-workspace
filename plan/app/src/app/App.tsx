// App-shell -- гілкування LoginScreen / DeckScreen залежно від наявності й
// валідності JWT-сесії у сховищі (ISS-52, ADR-0006 "### Фронтенд (ISS-52)").
//
// DI (той самий стиль, що DeckScreen.loadCards): readStoredSession/
// writeStoredSession/now -- ін'єктовані, компонент не знає, що це
// localStorage['plan.jwt'] і Date.now() (composition root -- main.tsx).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveScreen, CreateCardForm, DeckScreen } from '../cards/life-area-card';
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
// D-121 (docs/app-shell.md): ChatPanel (колишній ChatScreen) рендериться
// нижче ЯВНО ПОЗА перемикачем `direction` -- постійна панель, не напрямок.
import { AccountScreen, ChatPanel, ReportsScreen, RuleSettingsScreen } from '../agent';
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
  /** Видаляє (архівує) блок-метрику обраної картки (DELETE /cards/{id}/metric-blocks/{metricBlockId}, CardBack.onArchiveMetricBlock). */
  archiveMetricBlock: (cardId: string, metricBlockId: string) => Promise<void>;
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

// D-121 (живе тестування): 'detail' прибрано -- відкриття картки окремим
// екраном скасоване, передня картка в DeckScreen/DeckGrid сама несе повний
// вміст (CardFace/CardBack) на місці. CardDetailScreen.tsx видалено.
//
// Задача 13: варіант 'archive' носить `from` -- напрямок (Direction), з
// якого користувач відкрив архів, щоб кнопка "Назад" повертала саме туди
// (а не завжди на 'cards' / екран Картки, як було). Зараз єдиний вхід в
// архів -- AnalyticsScreen.onOpenArchive нижче ('analytics'), тож `from`
// завжди 'analytics' на практиці, але поле типізоване як Direction, а не
// як буквальний літерал -- якщо колись з'явиться ще один вхід в архів, він
// просто підставить свій напрямок, і "Назад" сам поведеться правильно без
// додаткової гілки коду.
type Screen = { screen: 'deck' } | { screen: 'create' } | { screen: 'archive'; from: Direction };

// T24 (sad.md §5 "Навігація (чотири напрямки)") + T29 (агент, D-25 "єдиний
// канал прямого вводу"): постійне нижнє нав-меню, незалежне від Screen
// (Screen лишається під-навігацією "Картки" -- deck/create/archive, D-122
// прибрав 'detail' -- той самий стан переживає перехід на інший напрямок і
// назад -- тест "клік Картки повертає на DeckScreen"). Три напрямки --
// Налаштування правил/Звіти активності/Обліковий запис і дані -- один екран
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
type Direction = 'cards' | 'declaration' | 'layout' | 'analytics' | 'agent-rules' | 'agent-reports' | 'agent-account';

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
  // D-121 (docs/app-shell.md) замінює T29 DoD ("App boots with Чат as the
  // default screen"): Чат більше не "напрямок" контентної зони -- він
  // постійна ChatPanel, видима одночасно з БУДЬ-яким напрямком (нижче), тож
  // сама ідея "дефолтний напрямок = агент" (D-25) тепер задоволена сильніше
  // (завжди на екрані, не лише як стартовий) без потреби займати контентну
  // зону при вході. Дефолт контентної зони -- Картки (найбільш змістовний
  // напрямок за замовчуванням).
  const [direction, setDirection] = useState<Direction>('cards');
  // D-123 (живе тестування): меню налаштувань у верхньому барі -- три
  // напрямки (agent-rules/agent-account/agent-reports), що ISS-117 називав
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
          <h1 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink">
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
                  setDirection('agent-reports');
                  setIsSettingsMenuOpen(false);
                }}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
              >
                Звіти активності
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
              loadCloseCardOptions={loadCloseCardOptions}
              onCloseCard={onCloseCard}
            />
          )}
          {direction === 'analytics' && (
            <AnalyticsScreen
              loadAnalytics={loadAnalytics}
              // D-124 (живе тестування): "Архів" переїхав сюди з Колоди --
              // перемикає ОБИДВА рівні стану одразу (direction на 'cards' +
              // внутрішній Screen на 'archive'), бо сам ArchiveScreen (SCR-07)
              // лишається під-навігацією "Картки", не власним напрямком.
              onOpenArchive={() => {
                setDirection('cards');
                // Задача 13: запам'ятовуємо, що цей архів відкрили з
                // Аналітики, щоб "Назад" (нижче) повернув сюди ж, а не на
                // Картки.
                setScreen({ screen: 'archive', from: 'analytics' });
              }}
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
          {direction === 'cards' && screen.screen === 'archive' && (
            <div className="flex flex-col gap-4">
              <Button
                label="← Назад"
                onClick={() => {
                  // Задача 13: повертаємось туди, звідки відкрили архів
                  // (screen.from -- напр. 'analytics'), не завжди на 'cards'
                  // -- раніше цей клік вів на Картки навіть коли користувач
                  // прийшов із Аналітики, бо direction лишався 'cards' з
                  // моменту onOpenArchive.
                  setDirection(screen.from);
                  setScreen({ screen: 'deck' });
                }}
              />
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
              onCreateCard={() => setScreen({ screen: 'create' })}
              // D-124 (живе тестування): "Архів"/"Вийти" прибрано звідси --
              // "Архів" переїхав на Літопис-Аналітику (AnalyticsScreen.onOpenArchive
              // вище), "Вийти" -- у верхній бар (поруч із шестернею).
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
            />
          )}
        </div>

        {/* T24 (sad.md §5): постійне нижнє нав-меню -- видиме на всіх
            напрямках, не лише на "Картки". "Картки" не скидає під-навігацію
            create/detail/archive -- лише перемикає direction, Screen
            лишається як був (тест "клік Картки повертає на DeckScreen").
            D-111: усі пункти -- одного класу дії (навігація між напрямками)
            -- лишаються згруповані в одному <nav>, тепер з переносом рядків
            (flex-wrap), щоб на вузькому екрані (~360-400px) вони НЕ виходили
            за межі екрана й не змушували сторінку скролитись горизонтально.
            D-121: "Чат" звідси прибрано -- він більше не напрямок (ChatPanel
            нижче, поза цим <nav>). D-123 (живе тестування): ще 3 пункти
            (Налаштування правил/Звіти активності/Обліковий запис і дані)
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
          <Button label="Картки" onClick={() => setDirection('cards')} />
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
