// Точка входу застосунку.
//
// Правило залежностей (ADR-0004): app має право імпортувати cards/ і shared/.
// Це єдине місце, яке знає і про картки, і про конкретну реалізацію
// транспорту (fetch до /api/v1/... -- бекенд T30, ADR-0006).
//
// Колода (life-area-card, D-23) -- стартовий екран застосунку (T30 DoD:
// "Застосунок запускається з Колодою, доступною з навігації"). Картка
// імпортується ЛИШЕ через свій index.ts (правило залежностей).
//
// loadCards -- ін'єктована реалізація DeckScreen.loadCards (ISS-45/T30):
// реальний fetch GET /api/v1/cards з'явився тут уперше в проєкті. Токен
// (Bearer JWT, D-109) читається з localStorage -- екран входу (обмін Google
// ID-токена на наш JWT через POST /api/v1/session) НЕ входить у DoD цієї
// задачі (T30 монтує лише транспорт), тому без токена запит просто
// повертає 401, і DeckScreen показує це як звичайну помилку (Banner) --
// не крах застосунку.
//
// onOpenCard -- поки що заглушка: екран деталей картки (комбінація
// CardFace/CardBack) ще не зареєстрований у app-shell жодною задачею.
// Навігація до нього -- деталь майбутньої задачі, не цієї (sad.md §5:
// "порядок навігації -- деталь реалізації").

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DeckScreen } from '../cards/life-area-card';
import type { DeckGridItem } from '../cards/life-area-card';

const JWT_STORAGE_KEY = 'plan.jwt';

interface CardDto {
  id: string;
  name: string;
}

interface CardPageDto {
  items: CardDto[];
}

async function loadCards(): Promise<DeckGridItem[]> {
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  const response = await fetch('/api/v1/cards', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Не вдалося завантажити колоду карток');
  }

  const page = (await response.json()) as CardPageDto;
  return page.items.map((card) => ({ id: card.id, name: card.name }));
}

function onOpenCard(cardId: string): void {
  // TODO(майбутня задача): екран деталей картки (CardFace/CardBack) ще не
  // зареєстрований в app-shell -- поки лише фіксуємо намір відкрити картку.
  console.log('Відкрити картку', cardId);
}

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>ПЛАН</h1>
      <DeckScreen loadCards={loadCards} onOpenCard={onOpenCard} />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Не знайдено елемент #root у index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
