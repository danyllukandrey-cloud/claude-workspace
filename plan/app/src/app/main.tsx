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
  cacheEntries,
  cacheEntry,
  cacheMetricBlocks,
  computeProgressFromCache,
  readCachedEntries,
  readCachedMetricBlocks,
} from '../cards/life-area-card';
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

/** Стирає сесію зі сховища (кнопка "Вийти", ISS-58). */
function clearStoredSession(): void {
  localStorage.removeItem(JWT_STORAGE_KEY);
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

/** Вантажить GIS-скрипт один раз (idempotent -- усі виклики діляться тим самим Promise). */
function loadGoogleIdentityScript(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      // Тег уже доданий (напр. HMR перезапустив цей модуль, але DOM лишився) --
      // якщо він і справді вже довантажився раніше, window.google вже є, і
      // подія `load` вдруге не спрацює -- перевіряємо це явно, а не лише
      // чекаємо подію.
      if (window.google) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Не вдалося завантажити скрипт Google Identity Services')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Не вдалося завантажити скрипт Google Identity Services')));
    document.head.appendChild(script);
  });

  return gisScriptPromise;
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

async function loadCard(cardId: string): Promise<CardFaceData> {
  const response = await fetch(`/api/v1/cards/${cardId}`, { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити картку');
  }

  const card = (await response.json()) as CardDetailDto;
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
  const cachedBlocks = readCachedMetricBlocks(storage, cardId);
  if (cachedBlocks.length === 0) return null;

  const cachedEntries = readCachedEntries(storage, cardId);
  const metricBlocks: MetricBlockViewModel[] = cachedBlocks.map((block) => {
    const goal: MetricBlockGoal = { targetCount: block.targetCount, isOngoing: block.isOngoing };
    return {
      id: block.id,
      label: block.label,
      unit: block.unit,
      progress: computeProgressFromCache(storage, cardId, block.id, goal),
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
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити картку');
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
      const body = (await failed?.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? 'Не вдалося завантажити картку');
    }

    card = (await cardResponse.json()) as CardDetailDto;
    blocks = (await blocksResponse.json()) as MetricBlockDto[];
    allEntries = entriesResult;
  } catch (networkError) {
    // T45/QG-1: мережа недоступна (чи бекенд повернув помилку) -- відповідаємо
    // повністю з кешу, якщо є з чим; інакше пробрасуємо оригінальну помилку
    // (той самий текст, що бачив би користувач і без цього фіксу).
    const fromCache = loadBackFromCache(cardId);
    if (fromCache) return fromCache;
    throw networkError;
  }

  // Успішна синхронізація -- кешуємо ОБИДВА джерела повним заміщенням (D-106,
  // review C13): наступне відкриття офлайн бачить рівно те, що бекенд щойно
  // показав, не застарілий чи частковий стан. Кеш теж отримує ПОВНИЙ набір
  // записів (усі сторінки), не лише першу -- той самий фікс, що C15 нижче.
  cacheMetricBlocks(storage, cardId, blocks.map(toCachedMetricBlock));
  cacheEntries(storage, cardId, allEntries.map(toDomainEntry));

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

async function loadArchivedCardHistory(cardId: string): Promise<EntryViewModel[]> {
  const response = await fetch(`/api/v1/cards/${cardId}/entries`, { headers: authHeaders() });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити історію записів');
  }

  const entryPage = (await response.json()) as EntryPageDto;
  return entryPage.items.map((entry) => toEntryViewModel(entry, undefined));
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
    body: JSON.stringify({ amount }),
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
  cacheEntry(storage, cardId, toDomainEntry(entry));
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
    />
  </StrictMode>,
);
