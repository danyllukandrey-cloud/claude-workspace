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
  cacheEntry,
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
  CloseCardMetricTransferInput,
  DeclarationScreenState,
  GapTrend,
  LayoutBoardCloseCardOptions,
  LayoutBoardState,
  LayoutMode,
  LogicVariant,
} from '../structure';
import {
  computeCardGapTrend,
  computeLogicLayoutGaps,
  computeStructureAggregate,
  flagUnmaintainedCards,
  logicLayoutScale,
} from '../structure';
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

const DEVICE_ID_STORAGE_KEY = 'plan.deviceId';

/**
 * Review 2026-09-07 (виправлення регресу B7, знайденого повторним рев'ю):
 * detectConflict (domain/conflict.ts) не має жодного способу відрізнити "той
 * самий пристрій, два швидких записи" від "справді різні пристрої" (AC-06)
 * без стійкого ідентифікатора пристрою -- цей клієнт раніше взагалі ніколи
 * не надсилав sourceDeviceId, тому КОЖЕН другий запис на тому самому блоці
 * трактувався як можливий конфлікт і скидав прогрес назад у "очікує".
 * Генерується ОДИН РАЗ і зберігається в localStorage -- переживає
 * перезавантаження сторінки, унікальний для ЦЬОГО браузера (не для
 * користувача -- той самий Google-акаунт з іншого пристрою отримає свій
 * власний id, що й потрібно для AC-06).
 */
function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    // Приватний режим / переповнене сховище -- новий id щоразу; конфлікт-
    // детекція після цього ж фіксу трактує "невідомий пристрій" як "той
    // самий" (безпечний дефолт), тож це не ламає звичайний потік, лише не
    // ловить рідкісний реальний конфлікт із цього самого сеансу.
    return crypto.randomUUID();
  }
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
 * (loadBack/addEntry) підставляють порожній рядок як безпечний fallback
 * (кеш просто не намespaced для цього єдиного виклику, не крах).
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
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large' });
    })
    .catch((error: unknown) => {
      console.error(error);
      onError?.(GOOGLE_LOAD_ERROR_MESSAGE);
    });
}

async function loadCards(): Promise<DeckGridItem[]> {
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
  return page.items.map((card) => ({ id: card.id, name: card.name }));
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
    const cached = readCachedCardFace(storage, ownerUserId, cardId);
    if (cached) return { ...cached, dataWarning: null };
    throw networkError;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'card.request_failed', body?.message ?? 'Не вдалося завантажити картку', response.status);
  }

  const card = (await response.json()) as CardDetailDto;
  cacheCardFace(storage, ownerUserId, cardId, { name: card.name, description: card.description });
  return { name: card.name, description: card.description, dataWarning: card.dataWarning };
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
    };
  });

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const entries: EntryViewModel[] = allEntries.map((entry) => toEntryViewModel(entry, blockById.get(entry.metricBlockId)));

  return { metricBlocks, aggregateProgress: card.aggregateProgress, entries };
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

/** ТИМЧАСОВО (D-110, docs/DECISIONS.md) -- реальний POST .../metric-blocks/{metricBlockId}/entries -- CardBack.onAddEntry. */
async function addEntry(cardId: string, metricBlockId: string, amount: number): Promise<void> {
  const response = await fetch(`/api/v1/cards/${cardId}/metric-blocks/${metricBlockId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    // Review 2026-09-07 (B7 regression fix): sourceDeviceId -- див. getDeviceId вище.
    body: JSON.stringify({ amount, sourceDeviceId: getDeviceId() }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти запис');
  }

  // T45 (review C13, "writes to it ... after every ... confirmed entry"):
  // CardBack одразу перезавантажує дані після успішного addEntry (ISS-60),
  // що й так синхронізує весь кеш через loadBack вище -- цей рядок лише
  // страхує вікно МІЖ "запис прийнято" і "перезавантаження завершилось",
  // щоб застосунок не показав застарілий кеш, якщо мережа зникне саме тоді.
  const entry = (await response.json()) as EntryDto;
  cacheEntry(storage, currentOwnerUserId() ?? '', cardId, toDomainEntry(entry));
}

// T24 (sad.md §5, contracts/openapi.yaml Structure/Layout tags): реальні
// fetch-реалізації DI-пропів DeclarationScreen/LayoutBoard/AnalyticsScreen
// (structure/index.ts). Той самий стиль authHeaders/AppError, що решта
// цього файлу (loadCards тощо).

interface StructureDto {
  id: string;
  declaration: string | null;
  layoutMode: LayoutMode;
  logicVariant: LogicVariant;
  createdAt: string;
  updatedAt: string;
}

interface LayoutPositionDto {
  cardId: string;
  /**
   * `null` -- активна позиція БЕЗ клітинки: картка лежить у треї нерозкладених
   * (AC-11b/AC-16b після скидання, AC-17 після відновлення з архіву). Колонка
   * стала nullable міграцією 06 (рев'ю 2026-09-11), тож сюди реально приходить
   * JSON-null -- трактувати його як число означало б показати картку в
   * клітинці 0.
   */
  cellIndex: number | null;
  status: 'active' | 'closed';
  positionUpdatedAt: string;
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

/**
 * Останній відомий клієнту спосіб розкладки (з найсвіжішого GET /structure) --
 * потрібен, щоб ВІДРІЗНИТИ "PATCH справді перемкнув режим/підвид" від "PATCH
 * зберіг лише декларацію". Сервер (app/update-structure.ts) скидає позиції
 * рівно за цією ж умовою: `layoutModeChanged || (logicVariantChanged &&
 * режим-результат === 'logic')` -- умова нижче її дзеркалить, а не вгадує.
 *
 * `null` -- клієнт ще не бачив Структури (екран Декларації не відкривався), тож
 * і зберегти з нього нічого не міг: банер у такому разі не показуємо, бо
 * порівнювати ні з чим (хибний банер гірший за відсутній).
 */
let lastKnownLayoutChoice: { layoutMode: LayoutMode; logicVariant: LogicVariant } | null = null;

/**
 * Клієнтський прапорець "щойно скинуто розкладку" (AC-11b/AC-16b).
 *
 * Review 2026-09-11 (MUST-FIX 3): тут стояв хардкод `justReset: false` із
 * коментарем "поки сервер не почне позначати" -- тобто банер "Розклади заново"
 * не показувався НІКОЛИ, попри те, що сервер реально знімає клітинку з кожної
 * позиції. Окремого поля в контракті (openapi.yaml) під цей факт немає й не
 * потрібно: скидання -- наслідок дії, яку зробив САМ цей клієнт, тож він її і
 * пам'ятає. Прапорець ОДНОРАЗОВИЙ: перше ж відкриття Схеми його з'їдає, інакше
 * банер висів би на кожному наступному заході.
 */
let layoutJustReset = false;

function consumeLayoutJustReset(): boolean {
  const justReset = layoutJustReset;
  layoutJustReset = false;
  return justReset;
}

/** GET /api/v1/structure -- декларація + спосіб розкладки (DeclarationScreen.loadStructure). `hasArrangedCards` (AC-11b/AC-16b confirm-reset) -- поза Structure DTO, похідне з активних позицій розкладки. */
async function loadStructure(): Promise<DeclarationScreenState> {
  const response = await fetch('/api/v1/structure', { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося завантажити Структуру', response.status);
  }

  const structure = (await response.json()) as StructureDto;
  rememberLayoutChoice(structure);
  const activePositions = await fetchActiveLayoutPositions();

  return {
    declaration: structure.declaration,
    layoutMode: structure.layoutMode,
    logicVariant: structure.logicVariant,
    // AC-11b/AC-16b: картка в треї (cellIndex === null) вже НЕ розкладена --
    // підтвердження "картки скинуться вниз" не має питатись, коли скидати
    // нічого. Після міграції 06 таких позицій реально повно.
    hasArrangedCards: activePositions.some((position) => position.cellIndex !== null),
  };
}

/** Єдине місце, де запам'ятовується спосіб розкладки з відповіді сервера. */
function rememberLayoutChoice(structure: StructureDto): void {
  lastKnownLayoutChoice = { layoutMode: structure.layoutMode, logicVariant: structure.logicVariant };
}

/** PATCH /api/v1/structure -- зберігає декларацію/режим розкладки (DeclarationScreen.onSave). */
async function onSaveDeclaration(input: { declaration: string; layoutMode: LayoutMode; logicVariant: LogicVariant }): Promise<void> {
  const response = await fetch('/api/v1/structure', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося зберегти Структуру', response.status);
  }

  // AC-11b/AC-16b: та сама умова, за якою сервер скидає позиції
  // (app/update-structure.ts). Прапорець ставиться ЛИШЕ після успішної
  // відповіді -- збій PATCH нічого на сервері не скинув, тож банер був би
  // брехнею.
  const previous = lastKnownLayoutChoice;
  if (previous !== null) {
    const layoutModeChanged = input.layoutMode !== previous.layoutMode;
    const logicVariantSwitched = input.logicVariant !== previous.logicVariant && input.layoutMode === 'logic';
    if (layoutModeChanged || logicVariantSwitched) {
      layoutJustReset = true;
    }
  }

  const saved = (await response.json().catch(() => null)) as StructureDto | null;
  if (saved) rememberLayoutChoice(saved);
  else lastKnownLayoutChoice = { layoutMode: input.layoutMode, logicVariant: input.logicVariant };
}

/**
 * GET /api/v1/structure/layout -- схема розкладки (LayoutBoard.loadLayout).
 *
 * `cardTitle` -- join із GET /api/v1/cards (openapi.yaml Structure API не
 * несе назв карток, sad.md §5 "картки показані лише назвами" -- назва
 * лишається за life-area-card). Картки без активної позиції (не в
 * `/structure/layout`) потрапляють у нерозкладений трей (`cellIndex: null`),
 * `baseOrder` -- порядок їх повернення GET /cards.
 *
 * `cellCount` НЕ несе жодний ендпоінт контракту (openapi.yaml) -- відома
 * прогалина (sad.md §11 "щільність поля розкладки" закрито лише на рівні §5.2
 * тексту, без окремого API-поля): тут це найбільший зайнятий індекс + запас
 * вільних клітинок (той самий текстовий принцип, що sad.md §5.2).
 *
 * `justReset` (AC-11b/AC-16b) -- клієнтський одноразовий прапорець, див.
 * layoutJustReset вище. Окремого поля в контракті він не потребує: скидання --
 * наслідок PATCH, який зробив цей самий клієнт.
 */
async function loadLayout(): Promise<LayoutBoardState> {
  const [positions, cards] = await Promise.all([fetchActiveLayoutPositions(), loadCards()]);
  const positionByCardId = new Map(positions.map((position) => [position.cardId, position]));
  // Позиції без клітинки (трей) у розмір сітки не входять -- інакше NULL
  // коерціювався б у 0 і міг би штучно підтягнути сітку до однієї клітинки.
  const maxCellIndex = positions.reduce(
    (max, position) => (position.cellIndex === null ? max : Math.max(max, position.cellIndex)),
    -1,
  );
  const FREE_CELL_BUFFER = 6;

  return {
    cellCount: maxCellIndex + 1 + FREE_CELL_BUFFER,
    justReset: consumeLayoutJustReset(),
    cards: cards.map((card, index) => {
      const position = positionByCardId.get(card.id);
      return {
        cardId: card.id,
        cardTitle: card.name,
        cellIndex: position?.cellIndex ?? null,
        baseOrder: index,
      };
    }),
  };
}

/** PUT /api/v1/structure/layout/{cardId} -- переміщення картки (LayoutBoard.onMoveCard, AC-08). */
async function onMoveCard(input: { cardId: string; cellIndex: number }): Promise<void> {
  const response = await fetch(`/api/v1/structure/layout/${input.cardId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cellIndex: input.cellIndex, positionUpdatedAt: now().toISOString() }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.move_failed', body?.message ?? 'Не вдалося зберегти позицію', response.status);
  }
}

/**
 * AC-12, SCR-04 -- що показати в діалозі "Закрити напрямок": метрики картки, що
 * закривається (GET /cards/{cardId}/metric-blocks), і куди їх можна перенести
 * (решта активних карток власника, GET /cards). Сама картка зі списку цілей
 * виключена -- переносити метрику в картку, яку закриваєш, безглуздо.
 *
 * ЕКСПОРТОВАНО, А НЕ ПЕРЕДАНО В <App>: AppProps (src/app/App.tsx) поля під
 * закриття напрямку поки не має, а App.tsx -- поза скоупом цього фіксу. Щойно
 * App.tsx отримає `loadCloseCardOptions`/`onCloseCard` і прокине їх у
 * <LayoutBoard> (LayoutBoardProps їх уже приймає), ці дві функції під'єднаються
 * без жодної зміни -- і AC-12 стане досяжним користувачу.
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
 * AC-12 -- POST /api/v1/structure/layout/{cardId}/close (LayoutBoard.onCloseCard).
 * Код помилки прокидається як є: SCR-04 розрізняє саме за ним
 * `metric_block.name_collision` (409 -> поле "нова назва") від
 * `structure.metric_transfer_target_invalid` (422 -> банер).
 *
 * Експортовано з тієї ж причини, що loadCloseCardOptions вище.
 */
export async function onCloseCard(input: {
  cardId: string;
  metricTransfers: CloseCardMetricTransferInput[];
}): Promise<void> {
  const response = await fetch(`/api/v1/structure/layout/${input.cardId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ metricTransfers: input.metricTransfers }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(
      body?.code ?? 'structure.close_failed',
      body?.message ?? 'Не вдалося закрити напрямок',
      response.status,
    );
  }
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
    loadCards(),
  ]);

  if (!structureResponse.ok) {
    const body = (await structureResponse.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new AppError(body?.code ?? 'structure.request_failed', body?.message ?? 'Не вдалося завантажити Структуру', structureResponse.status);
  }

  const structure = (await structureResponse.json()) as StructureDto;
  rememberLayoutChoice(structure);
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

  const { average, excludedCount } = computeStructureAggregate(
    cards.map((card) => ({
      cardId: card.id,
      cellIndex: positionByCardId.get(card.id)?.cellIndex ?? -1,
      progress: progressByCardId.get(card.id) ?? null,
    })),
  );

  const isLogicLayout = structure.layoutMode === 'logic';

  // AC-07: минулу розкладку читаємо ДО розрахунку розриву, бо вона входить у
  // шкалу (нижче). `null` -- історія не відповіла; порожній список -- відповіла,
  // просто другої точки немає.
  const pastPositions = isLogicLayout ? await fetchLayoutHistoryAsOf(trendCheckpoint()) : [];

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
  const scale = logicLayoutScale([...positions, ...(pastPositions ?? [])]);

  const gapByCardId = new Map<string, number>();
  if (isLogicLayout) {
    const gaps = computeLogicLayoutGaps(
      cards
        .filter((card) => progressByCardId.get(card.id) !== null && progressByCardId.get(card.id) !== undefined)
        .map((card) => ({
          cardId: card.id,
          // Картка без активної позиції (чи в треї) -- cellIndex null: розриву
          // не отримує взагалі (aggregate.ts), а не розрив "як для клітинки 0".
          cellIndex: positionByCardId.get(card.id)?.cellIndex ?? null,
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
  if (isLogicLayout && pastPositions !== null) {
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
        past.cellIndex === null ||
        !current ||
        current.cellIndex === null ||
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
              pastCellIndex: past.cellIndex,
              pastObservedAt: past.positionUpdatedAt,
              currentCellIndex: current.cellIndex,
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
  if (!isLogicLayout) {
    const maintenance = await Promise.all(
      cards.map(async (card) => ({ cardId: card.id, ...(await fetchCardMaintenance(card.id)) })),
    );
    for (const cardId of flagUnmaintainedCards(maintenance)) unmaintainedIds.add(cardId);
  }

  return {
    layoutMode: structure.layoutMode,
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
      addEntry={addEntry}
      onUpdateDescription={onUpdateDescription}
      onFlagEntry={onFlagEntry}
      loadStructure={loadStructure}
      onSaveDeclaration={onSaveDeclaration}
      loadLayout={loadLayout}
      onMoveCard={onMoveCard}
      loadAnalytics={loadAnalytics}
      loadCloseCardOptions={loadCloseCardOptions}
      onCloseCard={onCloseCard}
    />
  </StrictMode>,
);
