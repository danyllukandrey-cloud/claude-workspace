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
// onOpenCard -- поки що заглушка: екран деталей картки (комбінація
// CardFace/CardBack) ще не зареєстрований у app-shell жодною задачею.
// Навігація до нього -- деталь майбутньої задачі, не цієї (sad.md §5:
// "порядок навігації -- деталь реалізації").

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { DeckGridItem } from '../cards/life-area-card';
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

/** Вантажить GIS-скрипт один раз (idempotent -- перевіряє, чи вже є тег на сторінці). */
function loadGoogleIdentityScript(): Promise<void> {
  const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Не вдалося завантажити скрипт Google Identity Services')));
    document.head.appendChild(script);
  });
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
  const session = readStoredSession();
  const response = await fetch('/api/v1/cards', {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити колоду карток');
  }

  const page = (await response.json()) as CardPageDto;
  return page.items.map((card) => ({ id: card.id, name: card.name }));
}

async function createCard(input: { name: string }): Promise<void> {
  const session = readStoredSession();
  const response = await fetch('/api/v1/cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося зберегти картку');
  }
}

function onOpenCard(cardId: string): void {
  // TODO(майбутня задача): екран деталей картки (CardFace/CardBack) ще не
  // зареєстрований в app-shell -- поки лише фіксуємо намір відкрити картку.
  console.log('Відкрити картку', cardId);
}

const root = document.getElementById('root');
if (!root) throw new Error('Не знайдено елемент #root у index.html');

createRoot(root).render(
  <StrictMode>
    <App
      readStoredSession={readStoredSession}
      writeStoredSession={writeStoredSession}
      now={now}
      requestSession={requestSession}
      renderGoogleButton={renderGoogleButton}
      loadCards={loadCards}
      onOpenCard={onOpenCard}
      createCard={createCard}
    />
  </StrictMode>,
);
