// DeckGrid (T25) -- колода карток, що перегортається (Андрій, скетч: "як
// банківські картки перелистуються в додатках"). Підтверджено раніше
// (docs/z-archive/life-area-card-design-review.md, ескіз №3 "Стос карток зі
// свайпом") -- сам концепт лишався незреалізованим, доки живе тестування
// сьогодні (2026-09-13) не показало, що замість нього стоїть звичайна сітка.
//
// Передня картка -- на весь розмір, клікабельна (відкриває картку). Позаду
// визирають ще до MAX_PEEK карток, кожна зсунута по діагоналі й трохи менша
// -- клік по будь-якій з них не відкриває картку, а лише переносить її
// наперед (той самий жест, що "перегорнути колоду"). Кнопки ‹/› -- те саме
// перемикання без свайпу (доступність, клавіатура, тести).
//
// Навмисно узагальнений компонент (ISS-46): нічого не знає про статус картки
// (активна / архівна) -- лише рендерить items стосом і повідомляє про клік
// через onOpen(id). Яку саме колекцію показати вирішує виклик пропами
// items/onOpen, а не сам DeckGrid.
//
// Правило залежностей (plan/app/CLAUDE.md): лише Tailwind-класи з токенів
// D-120 (plan/app/src/app/theme.css) -- жодного domain, жодного ports/app.
// Позиція карток у стосі -- єдиний випадок inline style тут: зсув/масштаб
// обчислюється з індексу картки в стосі, Tailwind не виражає довільних чисел.

import { useState } from 'react';

export interface DeckGridItem {
  /** Ідентифікатор картки -- прокидається в onOpen при кліку на передню картку. */
  id: string;
  /** Назва картки -- підпис картки в стосі. */
  name: string;
}

export interface DeckGridProps {
  /** Картки для показу стосом. Порожній масив -- відповідальність виклику (EmptyState), не DeckGrid. */
  items: DeckGridItem[];
  /** Викликається з id картки, коли користувач відкриває ПЕРЕДНЮ картку. */
  onOpen: (id: string) => void;
}

/** Скільки карток позаду передньої ще визирають (сам скетч показує 3). */
const MAX_PEEK = 3;

export function DeckGrid({ items, onOpen }: DeckGridProps): JSX.Element {
  const [frontIndex, setFrontIndex] = useState(0);

  if (items.length === 0) {
    return <></>;
  }

  // Клемп на випадок, якщо items став коротшим ззовні (напр. архівація)
  // під час перегляду стосу, а frontIndex лишився вказувати за межі.
  const safeFront = Math.min(frontIndex, items.length - 1);

  const layerCount = Math.min(items.length, MAX_PEEK + 1);
  const layers = Array.from({ length: layerCount }, (_, layer) => ({
    layer,
    item: items[(safeFront + layer) % items.length],
  }));

  function goNext() {
    setFrontIndex((safeFront + 1) % items.length);
  }

  function goPrev() {
    setFrontIndex((safeFront - 1 + items.length) % items.length);
  }

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-full">
        {/* Задні картки першими в DOM -- передня (layer 0) малюється останньою, зверху. */}
        {[...layers].reverse().map(({ layer, item }) => {
          const isFront = layer === 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => (isFront ? onOpen(item.id) : setFrontIndex(items.indexOf(item)))}
              style={{
                transform: `translate(${layer * 10}px, ${-layer * 12}px) scale(${1 - layer * 0.05})`,
                zIndex: layerCount - layer,
                opacity: 1 - layer * 0.16,
              }}
              className="absolute inset-0 flex items-start rounded-card border border-border bg-surface-solid p-5 text-left font-display text-lg font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
            >
              {item.name}
            </button>
          );
        })}
      </div>

      {items.length > 1 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Попередня картка"
            className="rounded-control border border-border px-4 py-2 text-sm font-bold text-ink hover:bg-border"
          >
            ‹
          </button>
          <span className="text-xs text-ink-faint">
            {safeFront + 1} / {items.length}
          </span>
          <button
            type="button"
            onClick={goNext}
            aria-label="Наступна картка"
            className="rounded-control border border-border px-4 py-2 text-sm font-bold text-ink hover:bg-border"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
