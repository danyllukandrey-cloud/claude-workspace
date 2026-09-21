// Точка входу застосунку.
//
// Правило залежностей (ADR-0004): app має право імпортувати cards/ і shared/.
// Це єдине місце, яке знає і про картки, і про конкретну реалізацію
// транспорту (fetch до /api/v1/... -- бекенд T30, ADR-0006) і сховища
// (localStorage), а також про реальну інтеграцію Google Identity Services
// (GIS, ADR-0006 "### Фронтенд (ISS-52)"). App.tsx (гілкування Login/Deck) і
// LoginScreen.tsx (GIS-кнопка) отримують усе це через ін'єктовані пропи --
// composition root лишається єдиним місцем побічних ефектів.
//
// Колода (life-area-card, D-23) -- стартовий екран застосунку (T30 DoD:
// "Застосунок запускається з Колодою, доступною з навігації"). Картка
// імпортується ЛИШЕ через свій index.ts (правило залежностей).
//
// loadCards -- ін'єктована реалізація DeckScreen.loadCards (ISS-45/T30):
// реальний fetch GET /api/v1/cards. Токен (Bearer JWT, D-109) читається з
// localStorage -- без токена (чи протермінованого) App.tsx рендерить
// LoginScreen замість DeckScreen, тож loadCards узагалі не викликається.
//
// loadCard/loadBack/onRename -- ін'єктовані реалізації CardDetailScreen
// (ISS-55 stage 2/3, docs/ISSUES.md). App.tsx сам замикає їх над cardId,
// обраним у Колоді -- ці функції тут приймають cardId явним параметром.
//
// D-106 (openapi.yaml "GET .../metric-blocks"): відповідь ендпоінту -- лише
// метадані блоку (label/unit/targetCount/isOngoing), БЕЗ обчисленого
// прогресу -- поля progress/overGoalAmount, які схема технічно дозволяє,
// НІКОЛИ не читаються звідси. Прогрес кожного блоку рахує сам PWA-клієнт
// (computeProgress, domain/progress.ts) із сирих подій GET .../entries --
// той самий підхід, що docs/features/life-area-card/adr/0001-recompute-progress-from-raw-events.md.
// Картковий агрегат (aggregateProgress, D-105) -- єдине число, яке довіряємо
// як є з GET /cards/{cardId} (сервер уже порахував середнє часток bounded-
// блоків, capped 100%).

import './theme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  CachedMetricBlock,
  CardBackData,
  CardFaceData,
  DeckGridItem,
  EntryViewModel,
  MetricBlockFormValues,
  MetricBlockGoal,
  MetricBlockViewModel,
  RawEntry,
} from '../cards/life-area-card';
import {
  computeProgress,
  computeAggregateProgress,
  cacheCardFace,
  cacheEntries,
  cacheMetricBlocks,
  clearAllCachedData,
  computeProgressFromCache,
  readCachedCardFace,
  readCachedEntries,
  readCachedMetricBlocks,
} from '../cards/life-area-card';
import type {
  AnalyticsScreenState,
  AnalyticsTrend,
  DeclarationScreenState,
  GapTrend,
  LayoutBoardCloseCardOptions,
  LayoutBoardState,
  LayoutMode,
} from '../structure';
import {
  computeCardGapTrend,
  computeLogicLayoutGaps,
  computeStructureAggregate,
  flagUnmaintainedCards,
  logicLayoutScale,
} from '../structure';
import type {
  AccountScreenResource,
  ChatMessage,
  ChatProposal,
  ComposerSendInput,
  ImperativeRuleCategory,
  LogEntryViewModel,
  OnboardingResult,
  RuleSettingsScreenRule,
  RuleSettingsScreenSaveInput,
  RuleSettingsScreenTargetCard,
  SendMessageResult,
} from '../agent';
import type { PlanHorizon } from '../plan-horizons';
import { AppError } from '../shared/errors';
import { collectAllPages } from '../shared/pagination';
import { createLocalStorageAdapter } from '../shared/storage/local';
import { App } from './App';
import type { StoredSession } from './App';
import type { SessionResult } from './LoginScreen';

// T45 (review 2026-09-07 B8/C13): ЄДИНЕ місце застосунку, що підставляє
// реальний StoragePort -- local-cache.ts (T11) сам його ніколи не створює
// (ADR-0004, DI). До цього фіксу жодна функція нижче взагалі не читала й не
// писала кеш -- QG-1 ("офлайн-читання 100%") був недосяжний у production,
// попри готовий і протестований local-cache.ts.
const storage = createLocalStorageAdapter();

const JWT_STORAGE_KEY = 'plan.jwt';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GOOGLE_LOAD_ERROR_MESSAGE = 'Не вдалося завантажити вхід через Google -- спробуйте ще раз';

interface CardDto {
  id: string;
  name: string;
  /** CH-02/CH-10 (docs/features/life-area-card/changes.md) -- "стан без вимірювань" / "постійний процес" / "з цілями та метриками". */
  trackingMode: 'state' | 'ongoing' | 'goals';
  healthState: 'active' | 'critical' | 'paused' | null;
}

interface CardPageDto {
  items: CardDto[];
}

interface CardDetailDto {
  id: string;
  name: string;
  description: string | null;
  aggregateProgress: number | null;
  dataWarning: string | null;
  /** CH-02/CH-10: те саме поле, що CardDto -- GET /cards/{id} несе його теж. */
  trackingMode: 'state' | 'ongoing' | 'goals';
  healthState: 'active' | 'critical' | 'paused' | null;
}

interface MetricBlockDto {
  id: string;
  cardId: string;
  label: string;
  unit: string;
  frequency: string | null;
  targetCount: number | null;
  isOngoing: boolean;
  targetDate: string | null;
}

/** GET .../metric-blocks -> CachedMetricBlock (T45) -- та сама форма, що local-cache.ts вимагає. */
function toCachedMetricBlock(block: MetricBlockDto): CachedMetricBlock {
  return {
    id: block.id,
    label: block.label,
    unit: block.unit,
    frequency: block.frequency,
    targetCount: block.targetCount,
    isOngoing: block.isOngoing,
    targetDate: block.targetDate,
  };
}

interface EntryDto {
  id: string;
  metricBlockId: string;
  cardId: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected';
  recordedAt: string;
}

interface EntryPageDto {
  items: EntryDto[];
  /** Review 2026-09-07 C15 (AC-09): курсор наступної сторінки -- сервер обмежує відповідь дефолтним лімітом 50 (entry-handlers.ts), null означає "останню сторінку вже отримано". */
  next_cursor: string | null;
}

/** Спільні заголовки авторизації (Bearer JWT, D-109) -- той самий Session, що loadCards/createCard. */
function authHeaders(): Record<string, string> {
  const session = readStoredSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/** Формат "27.08" -- достатньо для короткого підпису в історії записів (AC-13). */
function formatRecordedAtLabel(recordedAt: string): string {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit' }).format(new Date(recordedAt));
}

function readStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(JWT_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  localStorage.setItem(JWT_STORAGE_KEY, JSON.stringify(session));
}

/** Стирає сесію зі сховища (кнопка "Вийти", ISS-58). Review 2026-09-07 E (T52): також очищає весь офлайн-кеш (clearAllCachedData) -- інакше дані щойно вийшлого акаунта лишаються читомими на спільному пристрої для наступного, хто увійде. */
function clearStoredSession(): void {
  localStorage.removeItem(JWT_STORAGE_KEY);
  clearAllCachedData(storage);
}

/**
 * Review 2026-09-07 E (T52, local-cache namespacing): наш власний JWT несе
 * `sub` = app_user.id (ADR-0006 §Додаток, той самий sub, що server/app.ts
 * кладе в req.ownerUserId) -- ДЕКОДУЄМО (не верифікуємо -- підпис перевіряє
 * лише сервер, тут довіряємо власному щойно виданому токену) середній сегмент
 * (payload), щоб мати ownerUserId для ключів кешу без окремого мережевого
 * виклику. `null`, якщо сесії нема чи токен не JWT-форми -- викликачі
 * (loadBack) підставляють порожній рядок як безпечний fallback (кеш просто
 * не намespaced для цього єдиного виклику, не крах).
 */
function currentOwnerUserId(): string | null {
  const token = readStoredSession()?.token;
  if (!token) return null;

  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;

  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const payload = JSON.parse(json) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function now(): Date {
  return new Date();
}

async function requestSession(googleIdToken: string): Promise<SessionResult> {
  const response = await fetch('/api/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ googleIdToken }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? 'Не вдалося увійти через Google';
    throw new Error(message);
  }

  return body as SessionResult;
}

// ISS-59: кешуємо ОДИН Promise на рівні модуля, а не перевіряємо лише
// присутність тега <script> -- React 18 StrictMode (dev) двічі підряд
// монтує LoginScreen, і другий виклик встигав побачити щойно доданий, але
// ще НЕ завантажений тег і мовчки вважати це "готово" (window.google ще
// undefined) -- звідси хибний банер помилки поруч із робочою кнопкою.
// Тепер усі виклики чекають той самий реальний `load`, незалежно від
// кількості одночасних монтувань.
let gisScriptPromise: Promise<void> | null = null;

/**
 * Вантажить GIS-скрипт один раз (idempotent -- усі виклики діляться тим самим
 * Promise, поки він не відхилений).
 *
 * Review 2026-09-07 E (T52, "помилка завантаження GIS-скрипта кешується
 * назавжди, попри задокументований retry-афорданс"): раніше відхилений
 * Promise лишався в gisScriptPromise НАЗАВЖДИ -- будь-який наступний виклик
 * (LoginScreen.onError -> користувач тисне "Спробувати ще раз") просто
 * повертав ТОЙ САМИЙ уже відхилений Promise, без жодної реальної повторної
 * спроби, аж до фізичного перезавантаження сторінки (яке одне лише й скидало
 * б цю module-level змінну). Тепер на відхилення: (1) прибираємо старий
 * <script>-тег -- браузер не повторить мережевий запит для тега, що вже
 * зафейлився, лише для НОВОГО; (2) скидаємо кеш-змінну, щоб наступний виклик
 * дійсно почав спробу заново.
 */
function loadGoogleIdentityScript(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing && window.google) {
      // Тег уже доданий і справді довантажився раніше (напр. HMR перезапустив
      // цей модуль, але DOM лишився) -- подія `load` вдруге не спрацює,
      // перевіряємо це явно, а не лише чекаємо подію.
      resolve();
      return;
    }
    // Будь-який попередній тег (успішний без window.google -- недосяжно вище,
    // чи зафейлений) прибираємо: новий тег нижче гарантовано зробить свіжий
    // мережевий запит, не покладаючись на стан старого.
    existing?.remove();

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Не вдалося завантажити скрипт Google Identity Services')));
    document.head.appendChild(script);
  });

  gisScriptPromise = attempt;
  attempt.catch(() => {
    gisScriptPromise = null;
  });

  return attempt;
}

function renderGoogleButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
  onError?: (message: string) => void,
): void {
  loadGoogleIdentityScript()
    .then(() => {
      if (!window.google) {
        throw new Error('Google Identity Services недоступний');
      }

      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
        callback: (response) => onCredential(response.credential),
      });
      // D-120: власну кнопку малює сам Google (не наш код, реєстрація акаунта
      // Google того вимагає) -- єдине, що можемо підлаштувати, це форма
      // (shape 'pill' -- та сама заокругленість, що наші кнопки) і темна/світла
      // тема, звірена з системною темою пристрою (та сама автоматика, що
      // theme.css), щоб кнопка не лишалась світлою плямою на темному фоні.
      const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      window.google.accounts.id.renderButton(container, {
        theme: isDark ? 'filled_black' : 'outline',
        size: 'large',
        shape: 'pill',
      });
    })
    .catch((error: unknown) => {
      console.error(error);
      onError?.(GOOGLE_LOAD_ERROR_MESSAGE);
    });
}

/**
 * Спільний GET /api/v1/cards -- джерело правди і для loadCards (DeckScreen,
 * лише id/name) і для CH-02's join у loadLayout/loadAnalytics (structure/ui,
 * потребують ще й trackingMode/healthState, щоб домалювати м'ячик стану
 * "власним каналом", не перевикористовуючи UI картки -- structure/changes.md
 * CH-02). Один fetch, дві форми споживання -- не два окремі запити тієї
 * самої колекції.
 */
async function fetchCardSummaries(): Promise<CardDto[]> {
  const response = await fetch('/api/v1/cards', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
    // Review 2026-09-07 C14 (AC-04): 401 -- сесія протермінована/невалідна,
    // не звичайна мережева помилка -- AppError несе httpStatus, за яким
    // DeckScreen (T48) розпізнає саме цей випадок і викликає onSessionExpired
    // замість показу банера-глухого-кута.
    if (response.status === 401) {
      throw new AppError(body?.code ?? 'auth.invalid_token', body?.message ?? 'Сесія протермінована', 401);
    }
    throw new Error(body?.message ?? 'Не вдалося завантажити колоду карток');
  }

  const page = (await response.json()) as CardPageDto;
  return page.items;
}

async function loadCards(): Promise<DeckGridItem[]> {
  const items = await fetchCardSummaries();
  return items.map((card) => ({ id: card.id, name: card.name }));
}

async function createCard(input: { name: string }): Promise<void> {
  const response = await fetch('/api/v1/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти картку');
  }
}

/**
 * Review 2026-09-07, post-ship follow-up review (C13, "офлайн-читання
 * картки взагалі не підключене"): раніше НІЯКОГО кеш-фолбеку тут не було --
 * офлайн лицьова сторона одразу падала в Banner-помилку без жодного
 * "перегорнути →", тож користувач не міг дістатись навіть до вже
 * кешованого (T45) звороту. Лише СПРАВЖНЯ мережева недоступність (fetch()
 * сам відхилився -- офлайн/DNS/timeout) падає в кеш; HTTP-статус (401/404)
 * обробляється ПОЗА цим catch і кидається як AppError, ніколи не
 * підмінюється застарілим кешем (сесія протермінована чи картка більше не
 * твоя -- показувати стару картку тут гірше, ніж чесно повідомити помилку).
 */
async function loadCard(cardId: string): Promise<CardFaceData> {
  const ownerUserId = currentOwnerUserId() ?? '';
  let response: Response;
  try {
    response = await fetch(`/api/v1/cards/${cardId}`, { headers: authHeaders() });
  } catch (networkError) {
    // CH-02: офлайн-кеш (CachedCardFace) не несе trackingMode/healthState --
    // навмисний, задокументований компроміс обсягу (offline-only fallback):
    // м'ячик стану просто не показується офлайн, деградує без крашу, той
    // самий "не блокуючий" дух, що й решта офлайн-фолбеків цього файлу.
    const cached = readCachedCardFace(storage, ownerUserId, cardId);
    if (cached) return { ...cached, dataWarning: null, trackingMode: 'goals', healthState: null };
    throw networkError;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'card.request_failed', body?.message ?? 'Не вдалося завантажити картку', response.status);
  }

  const card = (await response.json()) as CardDetailDto;
  cacheCardFace(storage, ownerUserId, cardId, { name: card.name, description: card.description });
  return {
    name: card.name,
    description: card.description,
    dataWarning: card.dataWarning,
    trackingMode: card.trackingMode,
    healthState: card.healthState,
  };
}

/**
 * T45 (review 2026-09-07 C13): мережа недоступна (чи бекенд не відповів) --
 * QG-1 вимагає, щоб картка й історія все одно відкривались, зі 100% з кешу.
 * Кеш метаданих блоків (readCachedMetricBlocks) -- єдиний сигнал "чи взагалі
 * є з чим офлайн відповісти": порожній список означає "картку ще ніколи не
 * синхронізовано онлайн" -- тоді офлайн-відповіді бути не може, пробрасуємо
 * оригінальну мережеву помилку, а не мовчки повертаємо порожню картку.
 */
function loadBackFromCache(cardId: string): CardBackData | null {
  const ownerUserId = currentOwnerUserId() ?? '';
  const cachedBlocks = readCachedMetricBlocks(storage, ownerUserId, cardId);
  if (cachedBlocks.length === 0) return null;

  const cachedEntries = readCachedEntries(storage, ownerUserId, cardId);
  const metricBlocks: MetricBlockViewModel[] = cachedBlocks.map((block) => {
    const goal: MetricBlockGoal = { targetCount: block.targetCount, isOngoing: block.isOngoing };
    return {
      id: block.id,
      label: block.label,
      unit: block.unit,
      progress: computeProgressFromCache(storage, ownerUserId, cardId, block.id, goal),
      hasPendingEntry: cachedEntries.some((entry) => entry.metricBlockId === block.id && entry.status === 'pending'),
    };
  });

  // Та сама формула, що бекенд (D-105, domain/progress.ts) -- не друга
  // незалежна копія, яка з часом розійшлась би з сервером.
  const aggregateProgress = computeAggregateProgress(metricBlocks.map((block) => block.progress));

  // Кешовані записи (domain Entry) не несуть recordedAt (readCachedEntries --
  // сирі події, не готовий view-model) -- на відміну від мережевої відповіді,
  // тут немає з чого показати дату запису чесно, тож recordedAtLabel лишаємо
  // порожнім, а не парсимо порожній рядок у Date (дало б "Invalid Date").
  const blockById = new Map(cachedBlocks.map((block) => [block.id, block]));
  const entries: EntryViewModel[] = cachedEntries.map((entry) => {
    const block = blockById.get(entry.metricBlockId);
    return {
      id: entry.id,
      metricBlockId: entry.metricBlockId,
      amount: entry.amount,
      status: entry.status,
      recordedAtLabel: '',
      summary: `+${entry.amount}${block ? ` ${block.unit}` : ''}`,
    };
  });

  return { metricBlocks, aggregateProgress, entries };
}

/**
 * Review 2026-09-07 C15 (AC-09): одна сторінка GET .../entries -- підставляється
 * як fetchPage у collectAllPages (shared/pagination.ts), яка сама слідує за
 * next_cursor, поки сервер не поверне null. Кидає той самий текст помилки, що
 * решта loadBack, аби фейл будь-якої сторінки виглядав для користувача
 * однаково незалежно від того, перша це сторінка чи п'ята.
 */
async function fetchEntryPage(cardId: string, after: string | undefined): Promise<EntryPageDto> {
  const url = `/api/v1/cards/${cardId}/entries${after ? `?after=${encodeURIComponent(after)}` : ''}`;
  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    // AppError (несе httpStatus), не plain Error -- review-followup C13:
    // loadBack нижче має вміти відрізнити "сервер відповів негативно" від
    // "мережі взагалі нема", а plain Error з обох джерел виглядав однаково.
    throw new AppError(body?.code ?? 'card.request_failed', body?.message ?? 'Не вдалося завантажити картку', response.status);
  }

  return (await response.json()) as EntryPageDto;
}

async function loadBack(cardId: string): Promise<CardBackData> {
  let card: CardDetailDto;
  let blocks: MetricBlockDto[];
  let allEntries: EntryDto[];
  try {
    const [cardResponse, blocksResponse, entriesResult] = await Promise.all([
      fetch(`/api/v1/cards/${cardId}`, { headers: authHeaders() }),
      fetch(`/api/v1/cards/${cardId}/metric-blocks`, { headers: authHeaders() }),
      // C15/AC-09: раніше лише ПЕРША сторінка (сервер обмежує дефолтним
      // лімітом 50, entry-handlers.ts) -- картка з понад 50 записами
      // мовчки недорахувала прогрес блоків, чиї записи опинились за межею
      // сторінки. collectAllPages слідує за next_cursor до кінця.
      collectAllPages<EntryDto>((after) => fetchEntryPage(cardId, after)),
    ]);

    if (!cardResponse.ok || !blocksResponse.ok) {
      const failed = [cardResponse, blocksResponse].find((response) => !response.ok);
      const body = (await failed?.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new AppError(body?.code ?? 'card.request_failed', body?.message ?? 'Не вдалося завантажити картку', failed?.status ?? 500);
    }

    card = (await cardResponse.json()) as CardDetailDto;
    blocks = (await blocksResponse.json()) as MetricBlockDto[];
    allEntries = entriesResult;
  } catch (networkError) {
    // Review 2026-09-07, post-ship follow-up review (C13 x C14): AppError
    // означає, що СЕРВЕР реально відповів (401 сесія протермінована, 404
    // card.not_found -- AC-04 non-disclosure) -- це НІКОЛИ не мережева
    // недоступність, тож ніколи не підміняється застарілим кешем (інакше
    // користувач без доступу далі бачив би стару картку). Лише СПРАВЖНЯ
    // мережева помилка (fetch() сам відхилився -- offline/DNS/timeout)
    // падає в кеш-фолбек.
    if (networkError instanceof AppError) throw networkError;
    const fromCache = loadBackFromCache(cardId);
    if (fromCache) return fromCache;
    throw networkError;
  }

  // Успішна синхронізація -- кешуємо ОБИДВА джерела повним заміщенням (D-106,
  // review C13): наступне відкриття офлайн бачить рівно те, що бекенд щойно
  // показав, не застарілий чи частковий стан. Кеш теж отримує ПОВНИЙ набір
  // записів (усі сторінки), не лише першу -- той самий фікс, що C15 нижче.
  const ownerUserId = currentOwnerUserId() ?? '';
  cacheMetricBlocks(storage, ownerUserId, cardId, blocks.map(toCachedMetricBlock));
  cacheEntries(storage, ownerUserId, cardId, allEntries.map(toDomainEntry));

  // D-106: `blocks` -- лише метадані (label/unit/targetCount/isOngoing), БЕЗ
  // прогресу. Прогрес кожного блоку рахуємо тут з сирих подій (RawEntry) --
  // тільки так, ніколи з можливого pre-computed поля відповіді.
  const metricBlocks: MetricBlockViewModel[] = blocks.map((block) => {
    const blockEntries = allEntries.filter((entry) => entry.metricBlockId === block.id);
    const goal: MetricBlockGoal = { targetCount: block.targetCount, isOngoing: block.isOngoing };
    const rawEntries: RawEntry[] = blockEntries.map((entry) => ({ amount: entry.amount, status: entry.status }));

    return {
      id: block.id,
      label: block.label,
      unit: block.unit,
      progress: computeProgress(goal, rawEntries),
      hasPendingEntry: blockEntries.some((entry) => entry.status === 'pending'),
      // CH-03 (docs/features/life-area-card/changes.md): сирі налаштування --
      // потрібні лише щоб попередньо заповнити форму редагування
      // (CardBack.tsx's MetricBlockForm initialValues), не для прогресу вище.
      settings: { targetCount: block.targetCount, isOngoing: block.isOngoing, targetDate: block.targetDate },
    };
  });

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const entries: EntryViewModel[] = allEntries.map((entry) => toEntryViewModel(entry, blockById.get(entry.metricBlockId)));

  return {
    metricBlocks,
    aggregateProgress: card.aggregateProgress,
    entries,
    trackingMode: card.trackingMode,
    healthState: card.healthState,
  };
}

/** EntryDto -> Entry (domain, для кешу) -- лише поля, які local-cache.ts вимагає. */
function toDomainEntry(entry: EntryDto): { id: string; metricBlockId: string; amount: number; status: EntryDto['status'] } {
  return { id: entry.id, metricBlockId: entry.metricBlockId, amount: entry.amount, status: entry.status };
}

/**
 * Мапить сирий EntryDto у EntryViewModel (recordedAtLabel + summary) -- спільна
 * логіка для loadBack (T26) і loadArchivedCardHistory (ISS-55 stage 3, T36),
 * винесена, щоб не дублювати formatRecordedAtLabel/summary в двох місцях.
 */
function toEntryViewModel(entry: EntryDto, block: MetricBlockDto | undefined): EntryViewModel {
  return {
    id: entry.id,
    metricBlockId: entry.metricBlockId,
    amount: entry.amount,
    status: entry.status,
    recordedAtLabel: formatRecordedAtLabel(entry.recordedAt),
    summary: `+${entry.amount}${block ? ` ${block.unit}` : ''}`,
  };
}

async function loadArchivedCards(): Promise<DeckGridItem[]> {
  const response = await fetch('/api/v1/cards?status=archived', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити архів карток');
  }

  const page = (await response.json()) as CardPageDto;
  return page.items.map((card) => ({ id: card.id, name: card.name }));
}

async function onRestoreCard(cardId: string): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося розархівувати картку');
  }
}

/**
 * Review 2026-09-07, post-ship follow-up review (E remainder): той самий
 * клас багу, що C15 (T48) уже виправив у loadBack -- читав лише ПЕРШУ
 * сторінку GET .../entries (дефолтний ліміт сервера 50), архівна картка з
 * понад 50 записами мовчки показувала обрізану історію без жодної ознаки,
 * що там є ще. collectAllPages (той самий, що loadBack) слідує за
 * next_cursor до кінця.
 */
async function loadArchivedCardHistory(cardId: string): Promise<EntryViewModel[]> {
  const allEntries = await collectAllPages<EntryDto>((after) => fetchEntryPage(cardId, after));
  return allEntries.map((entry) => toEntryViewModel(entry, undefined));
}

async function onRename(cardId: string, name: string): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти назву картки');
  }
}

/**
 * Review 2026-09-07 C10 (AC-03): реальний PATCH /cards/{cardId} (description/
 * markFilled) -- CardFace.onUpdateDescription. Сервер (update-card.ts) сам
 * кидає 422 card.description_required, коли markFilled:true без Опису --
 * тут лише прокидаємо його message, як і onRename вище.
 */
async function onUpdateDescription(cardId: string, input: { description: string; markFilled: boolean }): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ description: input.description, markFilled: input.markFilled }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти опис картки');
  }
}

/** ISS-56 (docs/ISSUES.md): реальний DELETE /cards/{cardId} -- CardFace.onArchive. */
async function archiveCard(cardId: string): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося архівувати картку');
  }
}

/**
 * CH-02 (docs/features/life-area-card/changes.md): реальний PATCH /cards/{cardId}
 * -- CardBack.onUpdateTracking. Той самий ендпоінт, що onUpdateDescription
 * вище, лише інше підмножина тіла (updateCard use-case приймає обидва набори
 * полів незалежно одне від одного).
 */
async function onUpdateTracking(
  cardId: string,
  input: { trackingMode: 'state' | 'ongoing' | 'goals'; healthState: 'active' | 'critical' | 'paused' | null },
): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ trackingMode: input.trackingMode, healthState: input.healthState }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти режим картки');
  }
}

/** ISS-60 (docs/ISSUES.md): реальний POST /cards/{id}/metric-blocks -- CardBack.onCreateMetricBlock. */
async function createMetricBlock(cardId: string, values: MetricBlockFormValues): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}/metric-blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      label: values.label,
      unit: values.unit,
      targetCount: values.targetCount,
      isOngoing: values.isOngoing,
      targetDate: values.targetDate,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти блок-метрику');
  }
}

/**
 * Реальний DELETE /cards/{cardId}/metric-blocks/{metricBlockId} --
 * CardBack.onArchiveMetricBlock (кнопка "×" на MetricBlockCard ->
 * ArchiveMetricBlockDialog, ввід слова "видалити"). Фіксований контракт
 * (паралельний бекенд-агент): успіх -- 200 з оновленим MetricBlock DTO
 * (status: "archived"), тіло тут не потрібне -- CardBack сам перевантажує
 * зворот (refresh()) після успіху, той самий стиль, що createMetricBlock/
 * archiveCard вище (DELETE, той самий парсинг помилки з body?.message).
 * 404 card.not_found (той самий код, що вже встановив transfer-metric-block,
 * ISS-30) прилітає як звичайна не-2xx відповідь -- тут нічого спеціально не
 * розрізняємо за кодом, лише показуємо message, як і всі сусідні виклики.
 */
async function archiveMetricBlock(cardId: string, metricBlockId: string): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}/metric-blocks/${metricBlockId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося видалити метрику');
  }
}

/**
 * CH-03 (docs/features/life-area-card/changes.md): реальний PATCH
 * /cards/{cardId}/metric-blocks/{metricBlockId} -- CardBack.onUpdateMetricBlock
 * (олівець на MetricBlockCard). Перейменування/зміна налаштувань, БЕЗ
 * перенесення на іншу картку (те робить onTransferMetricBlock нижче).
 */
async function onUpdateMetricBlock(cardId: string, metricBlockId: string, values: MetricBlockFormValues): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}/metric-blocks/${metricBlockId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      label: values.label,
      unit: values.unit,
      targetCount: values.targetCount,
      isOngoing: values.isOngoing,
      targetDate: values.targetDate,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти блок-метрику');
  }
}

/**
 * CH-03: реальний POST /cards/{targetCardId}/metric-blocks/transfer --
 * CardBack.onTransferMetricBlock. Той самий ендпоінт, що structure's
 * "Закрити напрямок" (CloseCardDialog) уже використовує -- наявний бекенд,
 * нового не додається (CH-03 юзер-кейс п.3). Перший параметр (картка-джерело)
 * узгоджує сигнатуру з App.tsx/DeckScreen.tsx (той самий cardId-префікс, що
 * решта DI-дій цього файлу) -- сам запит його не потребує: бекенд визначає
 * джерело з sourceMetricBlockId (ISS-30, transfer-metric-block.ts).
 */
async function onTransferMetricBlock(_sourceCardId: string, metricBlockId: string, targetCardId: string): Promise<void> {
  const response = await fetch(`/api/v1/cards/${targetCardId}/metric-blocks/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sourceMetricBlockId: metricBlockId }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося перенести блок-метрику');
  }
}

/**
 * Review 2026-09-07 C11 (AC-12): реальний PATCH /entries/{entryId} --
 * CardBack.onFlagEntry. "Виправити" переводить підтверджений запис у
 * 'rejected' -- "відкат" із формулювання AC-12 ("agent walks through
 * correcting or rolling it back"); сам діалог із агентом -- поза межами
 * цього UI (D-110, тимчасово), тут лише механіка "більше не рахується".
 * Повертає СВІЖИЙ CardBackData через повторний loadBack (не власний
 * response) -- CardBack.onFlagEntry вимагає саме це (той самий підхід, що
 * refresh() у CardBack.tsx для інших мутацій).
 */
async function onFlagEntry(cardId: string, entryId: string): Promise<CardBackData> {
  const response = await fetch(`/api/v1/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status: 'rejected' }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося виправити запис');
  }

  return loadBack(cardId);
}

// T24 (sad.md §5, contracts/openapi.yaml Structure/Layout tags): реальні
// fetch-реалізації DI-пропів DeclarationScreen/LayoutBoard/AnalyticsScreen
// (structure/index.ts). Той самий стиль authHeaders/AppError, що решта
// цього файлу (loadCards тощо).

interface StructureDto {
  id: string;
  declaration: string | null;
  layoutMode: LayoutMode;
  createdAt: string;
  updatedAt: string;
}

interface LayoutPositionDto {
  cardId: string;
  /**
   * D-131-наступне рішення (Андрій, чат, 2026-09-15): вільне полотно замість
   * фіксованої сітки клітинок -- `x`/`y` відсоток канви (0-100). Обидва
   * `null` разом -- активна позиція БЕЗ координат: картка лежить у купці
   * нерозкладених (AC-11b після зміни режиму без авто-розкладу для цього
   * режиму, AC-17 після відновлення з архіву).
   */
  x: number | null;
  y: number | null;
  status: 'active' | 'closed';
  positionUpdatedAt: string;
}

interface ConnectionDto {
  id: string;
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
  createdAt: string;
}

interface LayoutPositionPageDto {
  items: LayoutPositionDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

/** GET /api/v1/structure/layout -- лише активні позиції (contracts/openapi.yaml listLayoutPositions). Одна сторінка (MVP-обсяг десятків карток, sad.md §11 -- не оптимізуємо передчасно). */
async function fetchActiveLayoutPositions(): Promise<LayoutPositionDto[]> {
  const response = await fetch('/api/v1/structure/layout', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося завантажити розкладку', response.status);
  }

  const page = (await response.json()) as LayoutPositionPageDto;
  return page.items;
}

/** GET /api/v1/structure -- декларація (DeclarationScreen.loadStructure). Живе тестування (Андрій): режим розкладки (layoutMode) і "чи є що скинути" (hasArrangedCards) переїхали цілком на LayoutBoard -- цей запит більше НЕ тягне активні позиції, вони йому не потрібні. */
async function loadStructure(): Promise<DeclarationScreenState> {
  const response = await fetch('/api/v1/structure', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося завантажити Структуру', response.status);
  }

  const structure = (await response.json()) as StructureDto;
  return { declaration: structure.declaration };
}

/**
 * PATCH /api/v1/structure -- ЧАСТКОВЕ оновлення (declaration та/або
 * layoutMode, кожне опційне). Два DI-споживачі одного реального виклику
 * (живе тестування, Андрій): DeclarationScreen.onSave передає лише
 * `declaration`, LayoutBoard.onSaveLayoutMode передає лише `layoutMode` --
 * `JSON.stringify` сам відкидає ключ із значенням `undefined`, тож тіло PATCH
 * завжди несе РІВНО ті поля, що передав викликач (structure-handlers.ts
 * StructureUpdateBody вже й так підтримує частковий body).
 */
async function onSaveDeclaration(input: { declaration?: string; layoutMode?: LayoutMode }): Promise<void> {
  const response = await fetch('/api/v1/structure', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося зберегти Структуру', response.status);
  }

  await response.json().catch(() => null);
}

/** GET /api/v1/structure/connections -- усі зв'язки Структури (вимоги 4/5). */
async function fetchConnections(): Promise<ConnectionDto[]> {
  const response = await fetch('/api/v1/structure/connections', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? "Не вдалося завантажити зв'язки", response.status);
  }

  return (await response.json()) as ConnectionDto[];
}

/**
 * GET /api/v1/structure/layout (+ /connections, + /cards) -- схема
 * розкладки (LayoutBoard.loadLayout).
 *
 * `cardTitle` -- join із GET /api/v1/cards (openapi.yaml Structure API не
 * несе назв карток, sad.md §5 "картки показані лише назвами" -- назва
 * лишається за life-area-card). Картки без активної позиції (не в
 * `/structure/layout`) чи з x/y NULL потрапляють у купку нерозкладених
 * (D-131-наступне рішення: вільне полотно, `x`/`y` відсоток канви замість
 * cellIndex).
 *
 * `layoutMode` (вимога 15, "Готово до розкладання") -- окремий GET
 * /api/v1/structure поряд із позиціями/картками: LayoutBoard сам не знає
 * поточний режим (він живе на Структурі, не на розкладці), а йому треба
 * знати САМЕ 'staging', щоб зробити купку нерозкладених явним стійким
 * станом.
 */
async function loadLayout(): Promise<LayoutBoardState> {
  const [structureResponse, positions, connections, cards] = await Promise.all([
    fetch('/api/v1/structure', { headers: authHeaders() }),
    fetchActiveLayoutPositions(),
    fetchConnections(),
    // CH-02 (structure/changes.md): fetchCardSummaries (не DeckScreen's
    // narrower loadCards) -- потрібне trackingMode/healthState для м'ячика
    // стану на чипі, той самий один запит, ширша форма.
    fetchCardSummaries(),
  ]);

  // Ця Структура -- лише допоміжна підказка (staging-підказка), не критичні
  // дані канви/позицій: збій цього одного запиту навмисно НЕ валить весь
  // екран Схеми (той самий принцип, що AC-07's history-запит у loadAnalytics
  // нижче) -- просто немає підказки цього разу, `layoutMode` лишається null.
  let layoutMode: LayoutMode = null;
  if (structureResponse.ok) {
    const structure = (await structureResponse.json()) as StructureDto;
    layoutMode = structure.layoutMode;
  }

  const positionByCardId = new Map(positions.map((position) => [position.cardId, position]));

  return {
    layoutMode,
    cards: cards.map((card) => {
      const position = positionByCardId.get(card.id);
      return {
        cardId: card.id,
        cardTitle: card.name,
        x: position?.x ?? null,
        y: position?.y ?? null,
        // CH-02: власний канал (не перевикористання UI картки) -- лише
        // ненульове, коли картка справді в режимі "стан без вимірювань".
        healthState: card.trackingMode === 'state' ? card.healthState : null,
      };
    }),
    connections: connections.map((connection) => ({
      id: connection.id,
      cardIdA: connection.cardIdA,
      cardIdB: connection.cardIdB,
      directed: connection.directed,
    })),
  };
}

/** PUT /api/v1/structure/layout/{cardId} -- переміщення картки (LayoutBoard.onMoveCard, AC-08). */
async function onMoveCard(input: { cardId: string; x: number; y: number }): Promise<void> {
  const response = await fetch(`/api/v1/structure/layout/${input.cardId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ x: input.x, y: input.y, positionUpdatedAt: now().toISOString() }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.move_failed', body?.message ?? 'Не вдалося зберегти позицію', response.status);
  }
}

/** POST /api/v1/structure/connections -- створити лінію/стрілку (LayoutBoard.onCreateConnection, вимоги 4/5). */
async function onCreateConnection(input: { cardIdA: string; cardIdB: string; directed: boolean }): Promise<void> {
  const response = await fetch('/api/v1/structure/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.connection_failed', body?.message ?? "Не вдалося створити зв'язок", response.status);
  }
}

/** DELETE /api/v1/structure/connections/{connectionId} -- розірвати зв'язок (LayoutBoard.onDeleteConnection, вимога 4). */
async function onDeleteConnection(input: { connectionId: string }): Promise<void> {
  const response = await fetch(`/api/v1/structure/connections/${input.connectionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.connection_failed', body?.message ?? "Не вдалося видалити зв'язок", response.status);
  }
}

/**
 * AC-12, SCR-04 -- що показати в діалозі архівування (CH-05/CH-06,
 * docs/features/structure/changes.md): метрики картки, що архівується (GET
 * /cards/{cardId}/metric-blocks), і куди їх можна перенести (решта активних
 * карток власника, GET /cards). Сама картка зі списку цілей виключена --
 * переносити метрику в картку, яку архівуєш, безглуздо. Сам ендпоінт НЕ
 * структуроспецифічний -- та сама точка, що вже живить
 * CardBack.transferTargetCards, тож назва функції лишається історичною
 * (loadCloseCardOptions), перейменування поза межами CH-05/CH-06.
 */
export async function loadCloseCardOptions(cardId: string): Promise<LayoutBoardCloseCardOptions> {
  const [blocksResponse, cards] = await Promise.all([
    fetch(`/api/v1/cards/${cardId}/metric-blocks`, { headers: authHeaders() }),
    loadCards(),
  ]);

  if (!blocksResponse.ok) {
    const body = (await blocksResponse.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(
      body?.code ?? 'card.request_failed',
      body?.message ?? 'Не вдалося прочитати метрики картки',
      blocksResponse.status,
    );
  }

  const blocks = (await blocksResponse.json()) as MetricBlockDto[];
  return {
    metricBlocks: blocks.map((block) => ({ metricBlockId: block.id, label: block.label })),
    targetCards: cards
      .filter((card) => card.id !== cardId)
      .map((card) => ({ cardId: card.id, cardTitle: card.name })),
  };
}

/**
 * Зведена аналітика (AnalyticsScreen.loadAnalytics, AC-01/AC-04/AC-13).
 *
 * ADR-0001 ("ніколи не кешувати агрегат -- рахувати з сирих даних щоразу"):
 * тут переобчислюємо з GET /structure + GET /structure/layout + прогрес
 * кожної картки (GET /cards/{id}, той самий `aggregateProgress`, що вже
 * довіряємо в loadCard/loadBack вище) -- жодного окремого числа не
 * зберігаємо. computeStructureAggregate -- та сама формула, що бекендний
 * use-case `structure/app/get-analytics.ts` (domain/aggregate.ts, D-19
 * "одне рішення -- одне місце").
 *
 * РАНГ-РОЗРИВ, ТРЕНД І "НЕ ВЕДЕТЬСЯ" (AC-06/AC-06b/AC-07) -- теж тут, на
 * клієнті. Review 2026-09-11 (MUST-FIX 5): раніше всі три стояли хардкодом
 * (`gap: null`, `trend: null`, `unmaintained: false`, `trendAvailable: false`),
 * тож екран показував порожні числа й вічний банер "тренд недоступний".
 * Окремого ендпоінта аналітики контракт не має і не потребує: sad.md §6
 * Critical flow 9 прямо описує, що ці числа зводить САМ PWA -- із поточної
 * розкладки (GET /structure/layout), прогресу карток і МИНУЛОЇ розкладки
 * (GET /structure/layout/history?asOf=...). Формули -- доменні функції
 * structure/domain/aggregate.ts, ті самі, що бекендний use-case, не копія
 * (D-19).
 */
async function loadAnalytics(): Promise<AnalyticsScreenState> {
  const [structureResponse, positions, cards] = await Promise.all([
    fetch('/api/v1/structure', { headers: authHeaders() }),
    fetchActiveLayoutPositions(),
    // CH-02 (structure/changes.md): fetchCardSummaries -- та сама причина, що loadLayout вище.
    fetchCardSummaries(),
  ]);

  if (!structureResponse.ok) {
    const body = (await structureResponse.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося завантажити Структуру', structureResponse.status);
  }

  const structure = (await structureResponse.json()) as StructureDto;
  const positionByCardId = new Map(positions.map((position) => [position.cardId, position]));

  const cardDetails = await Promise.all(
    cards.map(async (card) => {
      const response = await fetch(`/api/v1/cards/${card.id}`, { headers: authHeaders() });
      if (!response.ok) return { id: card.id, aggregateProgress: null as number | null };
      const detail = (await response.json()) as CardDetailDto;
      return { id: card.id, aggregateProgress: detail.aggregateProgress };
    }),
  );
  const progressByCardId = new Map(cardDetails.map((detail) => [detail.id, detail.aggregateProgress]));

  // structure/domain/aggregate.ts's `cellIndex`-named fields below are
  // reused as-is (D-131-наступне рішення, Андрій у чаті, 2026-09-15) -- вони
  // завжди були лише "число, менше = вищий пріоритет", ніколи не залежали
  // від фіксованої сітки семантично. `x` (відсоток ширини канви, лівіше =
  // раніше в порядку) грає РІВНО ту саму роль, що cellIndex грав: формула
  // (aggregate.ts) лишається ОДНА (D-19), лише вхідне число тепер float
  // 0-100 замість цілого номера клітинки.
  const { average, excludedCount } = computeStructureAggregate(
    cards.map((card) => ({
      cardId: card.id,
      cellIndex: positionByCardId.get(card.id)?.x ?? -1,
      progress: progressByCardId.get(card.id) ?? null,
    })),
  );

  // Вимоги 14/15 (плоска модель): колишні три підвиди "за логікою"
  // (balance/focus/cause_effect) стали топ-рівневими значеннями layoutMode --
  // саме вони й далі несуть позиційну схему пріоритету (ранг-розрив AC-06),
  // на відміну від 'free'/'staging'/null, де такої схеми немає (AC-06b).
  const POSITION_PRIORITY_MODES: LayoutMode[] = ['balance', 'focus', 'cause_effect'];
  const hasPositionPriorityScheme = POSITION_PRIORITY_MODES.includes(structure.layoutMode);

  // AC-07: минулу розкладку читаємо ДО розрахунку розриву, бо вона входить у
  // шкалу (нижче). `null` -- історія не відповіла; порожній список -- відповіла,
  // просто другої точки немає.
  const pastPositions = hasPositionPriorityScheme ? await fetchLayoutHistoryAsOf(trendCheckpoint()) : [];

  // AC-06/AC-07: ОДНА шкала нормалізації на обидві точки часу.
  //
  // Беремо УСІ активні позиції (навіть карток без обчислюваного відсотка -- вони
  // теж займають клітинки) ПЛЮС клітинки з минулої точки. Чому разом: справжній
  // розмір сітки -- властивість режиму розкладки, і жодне поле контракту його не
  // несе (sad.md §11, відома прогалина), тож найкращий доступний клієнту проксі
  // -- найбільша клітинка, яку видно хоч в одній із двох точок. Якщо взяти лише
  // поточні позиції, минула клітинка за межами теперішньої сітки тихо
  // підтягнеться до її краю, і тренд сплющиться в "не змінився" саме тоді, коли
  // картка реально переїхала (рев'ю 2026-09-11, Частина 1/2: "поточний і минулий
  // gap рахуються в різних шкалах" -- тут навпаки, ОДНА лінійка на обидва числа
  // і на показаний розрив).
  const scale = logicLayoutScale(
    [...positions, ...(pastPositions ?? [])].map((position) => ({ cellIndex: position.x })),
  );

  const gapByCardId = new Map<string, number>();
  if (hasPositionPriorityScheme) {
    const gaps = computeLogicLayoutGaps(
      cards
        .filter((card) => progressByCardId.get(card.id) !== null && progressByCardId.get(card.id) !== undefined)
        .map((card) => ({
          cardId: card.id,
          // Картка без активної позиції (чи в купці нерозкладених) -- x null:
          // розриву не отримує взагалі (aggregate.ts), а не розрив "як для x=0".
          cellIndex: positionByCardId.get(card.id)?.x ?? null,
          progress: progressByCardId.get(card.id) as number,
        })),
      scale,
    );
    for (const gap of gaps) gapByCardId.set(gap.cardId, gap.gap);
  }

  // AC-07: напрямок зміни розриву. Контракт дає саме реконструкцію МИНУЛОЇ
  // розкладки (GET /structure/layout/history?asOf=...), не готовий розрив --
  // розрив на ту дату рахується тією ж формулою й тією ж шкалою, що поточний.
  // trendAvailable = false ТІЛЬКИ коли цей запит не відповів (AnalyticsScreen
  // саме так його й описує) -- не коли в конкретної картки бракує точок і не
  // коли розкладка не "за логікою" (там історію не питаємо взагалі, тож і
  // ламатись нічому: банер "тренд недоступний" мав би сенс лише як повідомлення
  // про збій).
  const trendAvailable = pastPositions !== null;
  const trendByCardId = new Map<string, AnalyticsTrend>();
  if (hasPositionPriorityScheme && pastPositions !== null) {
    const pastByCardId = new Map(pastPositions.map((position) => [position.cardId, position]));
    for (const card of cards) {
      const past = pastByCardId.get(card.id);
      const current = positionByCardId.get(card.id);
      const progress = progressByCardId.get(card.id);
      // Бракує хоч однієї з двох точок (картка не рухалась до контрольної дати,
      // лежить у треї, чи відсотка не має) -- напрямок невідомий, і це `null`,
      // а не вигадана стрілка.
      if (
        !past ||
        past.x === null ||
        !current ||
        current.x === null ||
        progress === null ||
        progress === undefined
      ) {
        continue;
      }

      trendByCardId.set(
        card.id,
        toAnalyticsTrend(
          computeCardGapTrend(
            {
              pastCellIndex: past.x,
              pastObservedAt: past.positionUpdatedAt,
              currentCellIndex: current.x,
              currentObservedAt: now().toISOString(),
              progress,
            },
            scale,
          ),
        ),
      );
    }
  }

  // AC-06b: розкладка без схеми пріоритету рангу не має -- натомість прапорець
  // "заявлено важливим (метрика є), не ведеться (нуль записів)". Запити за
  // метриками/записами робимо ЛИШЕ в цьому випадку: у режимі "за логікою"
  // прапорець не показується, тож і питати нічого.
  const unmaintainedIds = new Set<string>();
  if (!hasPositionPriorityScheme) {
    const maintenance = await Promise.all(
      cards.map(async (card) => ({ cardId: card.id, ...(await fetchCardMaintenance(card.id)) })),
    );
    for (const cardId of flagUnmaintainedCards(maintenance)) unmaintainedIds.add(cardId);
  }

  // AnalyticsScreen.tsx ще не переведений на плоску модель (окремий,
  // паралельний worktree/агент, вимоги 14/15 -- щоб уникнути конфлікту дві
  // задачі свідомо лишились розділені) -- його AnalyticsScreenState.layoutMode
  // досі типізований старою дворівневою формою ('single'|'free'|'logic'|null)
  // і рендер там читає лише `layoutMode === 'logic'`, щоб показати ранг-розрив.
  // Тимчасовий міст: hasPositionPriorityScheme (нова, правильна умова вище)
  // -> 'logic' зберігає той самий видимий результат; 'staging' (нове
  // значення, якого стара форма не знає) падає на найближчий старий
  // еквівалент 'free' -- "без заданої схеми пріоритету", той самий вибір, що
  // migrations/07_flatten_layout_mode.down.sql робить для розвороту схеми.
  // Прибрати цей міст, коли AnalyticsScreen.tsx (і його стан) самі перейдуть
  // на 5 плоских значень.
  let legacyLayoutModeForAnalyticsScreen: AnalyticsScreenState['layoutMode'];
  switch (structure.layoutMode) {
    case 'balance':
    case 'focus':
    case 'cause_effect':
      legacyLayoutModeForAnalyticsScreen = 'logic';
      break;
    case 'staging':
      legacyLayoutModeForAnalyticsScreen = 'free';
      break;
    default:
      // 'free' | null -- уже у старій формі як є.
      legacyLayoutModeForAnalyticsScreen = structure.layoutMode;
  }

  return {
    layoutMode: legacyLayoutModeForAnalyticsScreen,
    average,
    excludedCount,
    trendAvailable,
    cards: cards.map((card) => ({
      cardId: card.id,
      cardTitle: card.name,
      progress: progressByCardId.get(card.id) ?? null,
      gap: gapByCardId.get(card.id) ?? null,
      trend: trendByCardId.get(card.id) ?? null,
      unmaintained: unmaintainedIds.has(card.id),
      // CH-02: той самий принцип, що loadLayout -- власний канал.
      healthState: card.trackingMode === 'state' ? card.healthState : null,
    })),
  };
}

/**
 * Контрольна точка в минулому для тренду (AC-07). Конкретного вікна ні spec.md,
 * ні sad.md не називають ("попередня контрольна точка часу", Critical flow 9) --
 * тут тиждень: досить довго, щоб перетягування встигло статись, і досить
 * коротко, щоб "росте/меншає" говорило про зараз. Мусить бути в МИНУЛОМУ:
 * ports/layout-handlers.ts відповідає 422 structure.invalid_as_of на майбутню
 * дату.
 */
const TREND_CHECKPOINT_MS = 7 * 24 * 60 * 60 * 1000;

function trendCheckpoint(): Date {
  return new Date(now().getTime() - TREND_CHECKPOINT_MS);
}

/**
 * GET /api/v1/structure/layout/history?asOf=... -- розкладка на минулу дату.
 * `null` означає "історія не відповіла" (trendAvailable=false), а не "подій
 * немає": порожній список -- це теж успішна відповідь, просто без другої точки.
 * Збій цього одного запиту НЕ гасить решту екрана (T14 DoD: відсутність історії
 * ніколи не валить увесь розрахунок).
 */
async function fetchLayoutHistoryAsOf(asOf: Date): Promise<LayoutPositionDto[] | null> {
  try {
    const response = await fetch(`/api/v1/structure/layout/history?asOf=${encodeURIComponent(asOf.toISOString())}`, {
      headers: authHeaders(),
    });
    if (!response.ok) return null;
    const page = (await response.json()) as LayoutPositionPageDto;
    return page.items;
  } catch {
    return null;
  }
}

/**
 * Чи картку "заявили й ведуть" (AC-06b): метрика є / записів скільки. Читається
 * ЛИШЕ перша сторінка записів -- питання стоїть "нуль чи не нуль", а не
 * "скільки саме", тож доганяти next_cursor нема за чим. Збій будь-якого з двох
 * запитів -> `hasMetricBlock: false`: прапорець "не ведеться" не виставляється
 * на здогад (звинувачення без даних гірше за відсутній сигнал).
 */
async function fetchCardMaintenance(cardId: string): Promise<{ hasMetricBlock: boolean; entryCount: number }> {
  try {
    const [blocksResponse, entriesResponse] = await Promise.all([
      fetch(`/api/v1/cards/${cardId}/metric-blocks`, { headers: authHeaders() }),
      fetch(`/api/v1/cards/${cardId}/entries`, { headers: authHeaders() }),
    ]);
    if (!blocksResponse.ok || !entriesResponse.ok) return { hasMetricBlock: false, entryCount: 0 };

    const blocks = (await blocksResponse.json()) as MetricBlockDto[];
    const page = (await entriesResponse.json()) as EntryPageDto;
    return { hasMetricBlock: blocks.length > 0, entryCount: page.items.length };
  } catch {
    return { hasMetricBlock: false, entryCount: 0 };
  }
}

/**
 * Доменний GapTrend має чотири стани, а AnalyticsScreen's AnalyticsTrend -- три:
 * 'stable' ("точки є, розрив не змінився") він не знає. Звужуємо тут, на межі,
 * а не ховаємо всередині домену: `null` у 'stable' означає лише "стрілку не
 * показуємо". Розширення AnalyticsTrend до 'stable' -- правка
 * structure/ui/AnalyticsScreen.tsx, поза скоупом цього фіксу.
 */
function toAnalyticsTrend(trend: GapTrend): AnalyticsTrend {
  return trend === 'growing' || trend === 'shrinking' ? trend : null;
}

// --- Agent (T29 wiring -- contracts/openapi.yaml) --------------------------
//
// Той самий DI-стиль, що вже встановлений вище для cards/structure: кожна
// injected функція AppProps -- тонкий fetch + authHeaders()/AppError на межі,
// жодної бізнес-логіки тут (та вже вся в ../agent/app|domain/ports). Реюзує
// РІВНО ті самі DTO-поля, що ports/*.ts уже повертають (D-19) -- жодних
// вигаданих назв полів.

interface AgentMessageDto {
  id: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

interface AgentMessagePageDto {
  items: AgentMessageDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

interface AgentProposalDto {
  id: string;
  cardId: string | null;
  metricBlockId: string | null;
  status: 'active' | 'confirmed' | 'dropped';
  sourceType: 'text' | 'attachment';
  rawInput: string;
  proposedAmount: number | null;
  proposedSummary: string;
  createdAt: string;
  updatedAt: string;
}

interface MessageTurnDto {
  reply: string;
  proposal: AgentProposalDto | null;
}

interface ActiveProposalResponseDto {
  proposal: AgentProposalDto | null;
}

interface OnboardingStatusDto {
  welcomeShown: boolean;
  message: AgentMessageDto | null;
}

function toChatProposal(proposal: AgentProposalDto | null): ChatProposal | null {
  return proposal ? { id: proposal.id, proposedSummary: proposal.proposedSummary } : null;
}

/** GET /api/v1/messages -- повна історія (ChatPanel.loadHistory). MessagePage.items -- та сама форма, що ChatMessage. */
async function loadChatHistory(): Promise<ChatMessage[]> {
  const response = await fetch('/api/v1/messages', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'agent.request_failed', body?.message ?? 'Не вдалося завантажити історію чату', response.status);
  }

  const page = (await response.json()) as AgentMessagePageDto;
  return page.items;
}

/** GET /api/v1/onboarding -- вітальне повідомлення на перший виклик (ChatPanel.loadOnboarding, AC-13). */
async function loadChatOnboarding(): Promise<OnboardingResult> {
  const response = await fetch('/api/v1/onboarding', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'agent.request_failed', body?.message ?? 'Не вдалося завантажити вітання', response.status);
  }

  const status = (await response.json()) as OnboardingStatusDto;
  return { welcomeShown: status.welcomeShown, message: status.message };
}

/** GET /api/v1/proposals/active -- чи є пропозиція, що чекає підтвердження (ChatPanel.loadActiveProposal). */
async function loadActiveChatProposal(): Promise<ChatProposal | null> {
  const response = await fetch('/api/v1/proposals/active', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(
      body?.code ?? 'agent.request_failed',
      body?.message ?? 'Не вдалося завантажити активну пропозицію',
      response.status,
    );
  }

  const result = (await response.json()) as ActiveProposalResponseDto;
  return toChatProposal(result.proposal);
}

/**
 * Читає File як base64 (без префіксу `data:...;base64,`). POST /messages тут
 * приймає вкладення вже декодованим (mediaType+base64Data, той самий формат,
 * що ClaudeAttachment/server/app.ts очікують) -- див. коментар у
 * server/app.ts's POST /api/v1/messages про те, чому не справжній multipart.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Не вдалося прочитати вкладення'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Не вдалося прочитати вкладення'));
    reader.readAsDataURL(file);
  });
}

/** POST /api/v1/messages -- одне повідомлення/вкладення (ChatPanel.sendMessage, AC-01/AC-10/AC-19). */
async function sendChatMessage(input: ComposerSendInput): Promise<SendMessageResult> {
  const attachment = input.attachment
    ? { mediaType: input.attachment.type, base64Data: await fileToBase64(input.attachment) }
    : null;

  const response = await fetch('/api/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content: input.content, attachment }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    // 422/429/503 -- ChatPanel розрізняє через AppError-подібну форму (code+message), Banner-повідомлення.
    throw new AppError(body?.code ?? 'agent.message_failed', body?.message ?? 'Не вдалося надіслати повідомлення', response.status);
  }

  const turn = (await response.json()) as MessageTurnDto;
  return { reply: turn.reply, proposal: toChatProposal(turn.proposal) };
}

/** POST /api/v1/proposals/{id}/confirm -- підтвердження пропозиції (ChatPanel.confirmProposal, AC-02). */
async function confirmChatProposal(proposalId: string): Promise<void> {
  const response = await fetch(`/api/v1/proposals/${proposalId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'agent.confirm_failed', body?.message ?? 'Не вдалося підтвердити пропозицію', response.status);
  }
}

/**
 * GET /api/v1/cards -- перелік карток, доступних для card-override правил
 * (RuleSettingsScreen.targetCards, AC-12). Реюзає той самий ендпоінт, що
 * loadCards вище -- лише інша форма поля (cardId/cardTitle, не id/name).
 * Мовчазний фолбек на [] при помилці -- лише вужчий вибір override-скоупу
 * в UI, не критичний шлях (глобальні правила лишаються доступні).
 */
async function loadRuleTargetCards(): Promise<RuleSettingsScreenTargetCard[]> {
  const response = await fetch('/api/v1/cards', { headers: authHeaders() });
  if (!response.ok) return [];

  const page = (await response.json()) as CardPageDto;
  return page.items.map((card) => ({ cardId: card.id, cardTitle: card.name }));
}

interface AgentRuleDto {
  id: string;
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRulePageDto {
  items: AgentRuleDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toRuleSettingsRule(rule: AgentRuleDto): RuleSettingsScreenRule {
  return { id: rule.id, scopeCardId: rule.scopeCardId, category: rule.category, ruleText: rule.ruleText };
}

/** GET /api/v1/rules -- усі активні правила області (RuleSettingsScreen.loadRules, AC-08). Збирає всі сторінки (collectAllPages) -- список правил малий, той самий підхід, що вже усталений для інших невеликих колекцій. */
async function loadRules(scopeCardId: string | null): Promise<RuleSettingsScreenRule[]> {
  const rules = await collectAllPages<AgentRuleDto>(async (after) => {
    const query = new URLSearchParams();
    if (scopeCardId) query.set('scopeCardId', scopeCardId);
    if (after) query.set('after', after);
    const response = await fetch(`/api/v1/rules?${query.toString()}`, { headers: authHeaders() });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new AppError(body?.code ?? 'agent.request_failed', body?.message ?? 'Не вдалося завантажити правила', response.status);
    }

    return (await response.json()) as AgentRulePageDto;
  });

  return rules.map(toRuleSettingsRule);
}

/** POST /api/v1/rules -- зберігає одне правило (RuleSettingsScreen.onSave, AC-07/AC-08/AC-12/AC-14). */
async function onSaveRule(input: RuleSettingsScreenSaveInput): Promise<RuleSettingsScreenRule> {
  const response = await fetch('/api/v1/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    // 409 agent.rule_conflict / 422 agent.rule_empty -- RuleSettingsScreen розрізняє за `code`.
    throw new AppError(body?.code ?? 'agent.rule_save_failed', body?.message ?? 'Не вдалося зберегти правило', response.status);
  }

  return toRuleSettingsRule((await response.json()) as AgentRuleDto);
}

/** "15.09 14:32" -- dd.mm (той самий формат-стиль, що formatRecordedAtLabel вище) + hh:mm, для рядка Логу дій. */
function formatActionLogTimestampLabel(occurredAt: string): string {
  const date = new Date(occurredAt);
  const dateLabel = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit' }).format(date);
  const timeLabel = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${dateLabel} ${timeLabel}`;
}

interface AgentActionLogEntryDto {
  id: string;
  action: string;
  occurredAt: string;
}

interface AgentActionLogPageDto {
  items: AgentActionLogEntryDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

/** GET /api/v1/action-log -- Лог дій (LogScreen.loadActionLog), заміна GET /api/v1/reports/ReportsScreen у навігації. */
async function loadActionLog(): Promise<LogEntryViewModel[]> {
  const entries = await collectAllPages<AgentActionLogEntryDto>(async (after) => {
    const query = new URLSearchParams();
    if (after) query.set('after', after);
    const response = await fetch(`/api/v1/action-log?${query.toString()}`, { headers: authHeaders() });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new AppError(
        body?.code ?? 'agent.request_failed',
        body?.message ?? 'Не вдалося завантажити Лог дій',
        response.status,
      );
    }

    return (await response.json()) as AgentActionLogPageDto;
  });

  return entries.map((entry) => ({
    id: entry.id,
    occurredAtLabel: formatActionLogTimestampLabel(entry.occurredAt),
    action: entry.action,
  }));
}

interface AgentSyncResourceDto {
  id: string;
  url: string;
  status: 'active' | 'error';
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function toAccountScreenResource(resource: AgentSyncResourceDto): AccountScreenResource {
  return { id: resource.id, url: resource.url, status: resource.status, lastError: resource.lastError };
}

/** GET /api/v1/sync-resources -- список ресурсів синхронізації (AccountScreen.loadResources, AC-18). */
async function loadSyncResources(): Promise<AccountScreenResource[]> {
  const response = await fetch('/api/v1/sync-resources', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(
      body?.code ?? 'agent.request_failed',
      body?.message ?? 'Не вдалося завантажити ресурси синхронізації',
      response.status,
    );
  }

  const resources = (await response.json()) as AgentSyncResourceDto[];
  return resources.map(toAccountScreenResource);
}

/** POST /api/v1/sync-resources -- додає ресурс синхронізації (AccountScreen.onAddResource, AC-18). */
async function onAddSyncResource(url: string): Promise<AccountScreenResource> {
  const response = await fetch('/api/v1/sync-resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    // 422 sync_resource.url_invalid -- AccountScreen показує message inline під полем.
    throw new AppError(body?.code ?? 'sync_resource.add_failed', body?.message ?? 'Не вдалося додати ресурс', response.status);
  }

  return toAccountScreenResource((await response.json()) as AgentSyncResourceDto);
}

/** DELETE /api/v1/sync-resources/{id} -- прибирає ресурс синхронізації (AccountScreen.onRemoveResource). */
async function onRemoveSyncResource(resourceId: string): Promise<void> {
  const response = await fetch(`/api/v1/sync-resources/${resourceId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'sync_resource.remove_failed', body?.message ?? 'Не вдалося прибрати ресурс', response.status);
  }
}

/**
 * DELETE /api/v1/account -- видаляє акаунт і всі дані назавжди
 * (AccountScreen.onDeleteAccount, AC-17/AC-17b). ВІДКРИТЕ ПИТАННЯ (той
 * самий, що server/app.ts і ports/account-handler.ts коментують): контракт
 * не документує тіло DELETE-запиту -- цей клієнт надсилає `confirmed` у
 * JSON-тілі, узгоджено з тим, як server/app.ts його читає тут же.
 */
async function onDeleteAccount(confirmed: boolean): Promise<void> {
  const response = await fetch('/api/v1/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ confirmed }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'account.delete_failed', body?.message ?? 'Не вдалося видалити акаунт', response.status);
  }
}

// --- ПЛАН (T11, life-plan-levels/contracts/openapi.yaml) --------------------
//
// Чотири реальні виклики /api/v1/plan-items, які App.tsx прокидає в PlanScreen
// (T9) і PlanItemEditor (T10). Той самий стиль authHeaders/AppError, що решта
// файлу -- жодної власної обробки помилок, код із тіла відповіді доходить до
// екрана як є (PlanScreen показує його банером, PlanItemEditor -- під полем).

/** Рівно `components.schemas.PlanItem` контракту -- те саме, що PlanScreenItem. */
interface PlanItemDto {
  id: string;
  horizon: PlanHorizon;
  planText: string;
  done: boolean;
  createdAt: string;
}

interface PlanItemPageDto {
  items: PlanItemDto[];
  next_cursor: string | null;
}

async function fetchPlanItemPage(after: string | undefined): Promise<PlanItemPageDto> {
  const url = `/api/v1/plan-items${after ? `?after=${encodeURIComponent(after)}` : ''}`;
  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'plan_item.request_failed', body?.message ?? 'Не вдалося завантажити ПЛАН', response.status);
  }

  return (await response.json()) as PlanItemPageDto;
}

/**
 * GET /api/v1/plan-items -- УСІ активні пункти всіх трьох горизонтів
 * (PlanScreen.loadPlanItems, AC-08/AC-11).
 *
 * Сторінка контракту -- 50 пунктів за замовчуванням, а екран показує три
 * горизонти цілком, тож тут збираємо всі сторінки (collectAllPages, той самий
 * підхід, що історія записів картки) -- інакше в користувача з довгим планом
 * тихо зникали б пункти з кінця списку.
 */
async function loadPlanItems(): Promise<PlanItemDto[]> {
  return collectAllPages<PlanItemDto>(fetchPlanItemPage);
}

/**
 * POST /api/v1/plan-items (PlanItemEditor.onCreate, AC-01/AC-09).
 *
 * `Idempotency-Key` -- обов'язковий заголовок контракту: свіжий uuid на КОЖНЕ
 * натискання "Зберегти" (не на кожен рендер і не на сесію) -- саме повтор
 * ОДНОГО натискання (подвійний клік, мережевий ретрай) має повернути той
 * самий пункт, а два різні наміри користувача -- два різні пункти.
 */
async function onCreatePlanItem(input: { horizon: PlanHorizon; planText: string }): Promise<void> {
  const response = await fetch('/api/v1/plan-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    // 422 plan_item.text_required -- PlanItemEditor показує message під полем.
    throw new AppError(body?.code ?? 'plan_item.create_failed', body?.message ?? 'Не вдалося зберегти пункт', response.status);
  }
}

/**
 * PATCH /api/v1/plan-items/{planItemId} -- ЧАСТКОВЕ оновлення: тіло несе рівно
 * ті поля, що передав викликач (чекбокс із PlanScreen -- лише `done`, редактор
 * -- лише `planText`), та сама PATCH-семантика, що onSaveDeclaration вище.
 */
async function onUpdatePlanItem(planItemId: string, input: { planText?: string; done?: boolean }): Promise<void> {
  const response = await fetch(`/api/v1/plan-items/${planItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'plan_item.update_failed', body?.message ?? 'Не вдалося зберегти пункт', response.status);
  }
}

/** DELETE /api/v1/plan-items/{planItemId} -- м'яке прибирання (PlanItemEditor.onDelete, AC-04). */
async function onDeletePlanItem(planItemId: string): Promise<void> {
  const response = await fetch(`/api/v1/plan-items/${planItemId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'plan_item.delete_failed', body?.message ?? 'Не вдалося прибрати пункт', response.status);
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Не знайдено елемент #root у index.html');

createRoot(root).render(
  <StrictMode>
    <App
      readStoredSession={readStoredSession}
      writeStoredSession={writeStoredSession}
      clearStoredSession={clearStoredSession}
      now={now}
      requestSession={requestSession}
      renderGoogleButton={renderGoogleButton}
      loadCards={loadCards}
      createCard={createCard}
      loadCard={loadCard}
      loadBack={loadBack}
      onRename={onRename}
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={onRestoreCard}
      loadArchivedCardHistory={loadArchivedCardHistory}
      archiveCard={archiveCard}
      createMetricBlock={createMetricBlock}
      archiveMetricBlock={archiveMetricBlock}
      onUpdateTracking={onUpdateTracking}
      onUpdateMetricBlock={onUpdateMetricBlock}
      onTransferMetricBlock={onTransferMetricBlock}
      onUpdateDescription={onUpdateDescription}
      onFlagEntry={onFlagEntry}
      loadStructure={loadStructure}
      onSaveDeclaration={onSaveDeclaration}
      loadLayout={loadLayout}
      onMoveCard={onMoveCard}
      onCreateConnection={onCreateConnection}
      onDeleteConnection={onDeleteConnection}
      loadAnalytics={loadAnalytics}
      loadCloseCardOptions={loadCloseCardOptions}
      loadChatHistory={loadChatHistory}
      loadChatOnboarding={loadChatOnboarding}
      loadActiveChatProposal={loadActiveChatProposal}
      sendChatMessage={sendChatMessage}
      confirmChatProposal={confirmChatProposal}
      loadRuleTargetCards={loadRuleTargetCards}
      loadRules={loadRules}
      onSaveRule={onSaveRule}
      loadActionLog={loadActionLog}
      loadSyncResources={loadSyncResources}
      onAddSyncResource={onAddSyncResource}
      onRemoveSyncResource={onRemoveSyncResource}
      onDeleteAccount={onDeleteAccount}
      loadPlanItems={loadPlanItems}
      onCreatePlanItem={onCreatePlanItem}
      onUpdatePlanItem={onUpdatePlanItem}
      onDeletePlanItem={onDeletePlanItem}
    />
  </StrictMode>,
);
