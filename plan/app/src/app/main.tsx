// Точка входу застосунку.
//
// Що тут житиме далі:
//   - реєстрація карток (кожна картка підключається тут)
//   - "склеювання": підстановка реалізації сховища (local.ts) у порт (port.ts)
//
// Правило залежностей (ADR-0004): app має право імпортувати cards/ і shared/.
// Це єдине місце, яке знає і про картки, і про конкретну реалізацію сховища.
//
// Зараз рендериться заглушка — щоб `npm run dev` показував сторінку, а не порожнечу.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>ПЛАН</h1>
      <p>Каркас проєкту. Карток ще немає — вони з'являться в наступних задачах.</p>
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
