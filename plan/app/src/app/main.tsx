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
  CardBackData,
  CardFaceData,
  DeckGridItem,
  EntryViewModel,
  MetricBlockGoal,
  MetricBlockViewModel,
  RawEntry,
} from '../cards/life-area-card';
import { computeProgress } from '../cards/life-area-card';
import { App } from './App';
import type { StoredSession } from './App';
import type { SessionResult } from './LoginScreen';

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
  targetCount: number | null;
  isOngoing: boolean;
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
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
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

async function loadBack(cardId: string): Promise<CardBackData> {
  const [cardResponse, blocksResponse, entriesResponse] = await Promise.all([
    fetch(`/api/v1/cards/${cardId}`, { headers: authHeaders() }),
    fetch(`/api/v1/cards/${cardId}/metric-blocks`, { headers: authHeaders() }),
    fetch(`/api/v1/cards/${cardId}/entries`, { headers: authHeaders() }),
  ]);

  if (!cardResponse.ok || !blocksResponse.ok || !entriesResponse.ok) {
    const failed = [cardResponse, blocksResponse, entriesResponse].find((response) => !response.ok);
    const body = (await failed?.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити картку');
  }

  const card = (await cardResponse.json()) as CardDetailDto;
  const blocks = (await blocksResponse.json()) as MetricBlockDto[];
  const entryPage = (await entriesResponse.json()) as EntryPageDto;

  // D-106: `blocks` -- лише метадані (label/unit/targetCount/isOngoing), БЕЗ
  // прогресу. Прогрес кожного блоку рахуємо тут з сирих подій (RawEntry) --
  // тільки так, ніколи з можливого pre-computed поля відповіді.
  const metricBlocks: MetricBlockViewModel[] = blocks.map((block) => {
    const blockEntries = entryPage.items.filter((entry) => entry.metricBlockId === block.id);
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
  const entries: EntryViewModel[] = entryPage.items.map((entry) => toEntryViewModel(entry, blockById.get(entry.metricBlockId)));

  return { metricBlocks, aggregateProgress: card.aggregateProgress, entries };
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
    />
  </StrictMode>,
);
