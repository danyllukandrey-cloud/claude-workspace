// DeckGrid (T25) -- колода карток, що перегортається (Андрій, скетч: "як
// банківські картки перелистуються в додатках"). Підтверджено раніше
// (docs/z-archive/life-area-card-design-review.md, ескіз №3 "Стос карток зі
// свайпом") -- сам концепт лишався незреалізованим, доки живе тестування
// 2026-09-13 не показало, що замість нього стоїть звичайна сітка.
//
// Позаду передньої визирають ще до MAX_PEEK карток, кожна зсунута по
// діагоналі й трохи менша -- клік по будь-якій з них не відкриває картку, а
// лише переносить її наперед (той самий жест, що "перегорнути колоду").
// Кнопки ‹/› -- те саме перемикання без свайпу (доступність, клавіатура,
// тести). Кругова 3D-розкладка (D-121, "картки мають літати по колу навколо
// горизонтальної осі") -- ОКРЕМИЙ наступний крок, тут лишається попередній
// діагональний зсув.
//
// D-121 (живе тестування): передня картка більше НЕ кнопка-назва, що
// "відкриває" картку окремим екраном -- Андрій прямо сказав, цей крок
// зайвий. Замість `onOpen` -- render-prop `renderFront`: DeckGrid сам не
// знає, ЩО саме показати для передньої картки (ISS-46, "нічого не знає про
// статус картки" -- той самий принцип узагальненості тепер поширюється й на
// вміст переднього шару). DeckScreen.tsx передає сюди DeckFrontCard (повний
// CardShell, перевертається на місці); ArchiveScreen.tsx і далі передає
// просту кнопку-назву (`onOpen`-подібну поведінку тримає сам виклик, не
// DeckGrid) -- обидва лишаються сумісні з тим самим компонентом.
//
// Правило залежностей (plan/app/CLAUDE.md): лише Tailwind-класи з токенів
// D-120 (plan/app/src/app/theme.css) -- жодного domain, жодного ports/app.
// Позиція карток у стосі -- єдиний випадок inline style тут: зсув/масштаб
// обчислюється з індексу картки в стосі, Tailwind не виражає довільних чисел.

import { useState } from 'react';
import type { ReactNode } from 'react';

export interface DeckGridItem {
  /** Ідентифікатор картки -- прокидається в renderFront для передньої картки. */
  id: string;
  /** Назва картки -- підпис картки в стосі (завжди видима на задніх шарах, D-121 п.4). */
  name: string;
}

export interface DeckGridProps {
  /** Картки для показу стосом. Порожній масив -- відповідальність виклику (EmptyState), не DeckGrid. */
  items: DeckGridItem[];
  /**
   * Рендерить вміст ПЕРЕДНЬОЇ картки для даного item. DeckGrid сам не знає,
   * що це -- кнопка-назва (ArchiveScreen) чи повний CardShell (DeckScreen,
   * D-121) -- лишається узагальненим компонентом (ISS-46).
   */
  renderFront: (item: DeckGridItem) => ReactNode;
}

/** Скільки карток позаду передньої ще визирають (сам скетч показує 3). */
const MAX_PEEK = 3;

export function DeckGrid({ items, renderFront }: DeckGridProps): JSX.Element {
  const [frontIndex, setFrontIndex] = useState(0);

  if (items.length === 0) {
    return <></>;
  }

  // Клемп на випадок, якщо items став коротшим ззовні (напр. архівація
  // передньої картки, D-121 -- DeckFrontCard.onArchived перезавантажує
  // колоду) під час перегляду стосу, а frontIndex лишився вказувати за межі.
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
    // D-125 (живе тестування): gap-3 (не gap-4) -- та сама одиниця відступу,
    // що DeckScreen.tsx тепер використовує скрізь (картка/стрілки ‹›/кнопка/
    // нав-меню -- один спільний ритм, "усе пропорційно").
    <div className="mx-auto flex w-full max-w-xs min-h-0 flex-1 flex-col items-center gap-3">
      {/* D-121 (живе тестування): 85% висоти видимої зони контенту (батько --
          DeckScreen.tsx, `h-full` замість `min-h-screen`, і сам flex-1 вище)
          -- не фіксований aspect-ratio, як було, картка автоматично
          підлаштовується під висоту сторінки. */}
      <div className="relative h-[85%] w-full">
        {/* Задні картки першими в DOM -- передня (layer 0) малюється останньою, зверху. */}
        {/* Анімація перельоту (живе тестування): ОДИН тип обгортки (<div>) для
            всіх шарів -- і переднього, і задніх, з тим самим key={item.id}.
            React звіряє елементи по (key + тип тегу): якби передній шар був
            <div>, а задній -- <button>, зміна типу при переході "передня
            стала задньою" примусила б React розмонтувати й змонтувати вузол
            наново -- і CSS transition було б нічим анімувати (вузол щойно
            з'явився в DOM одразу в кінцевій позиції). Один стабільний <div>
            зберігає вузол картки живим при будь-якій зміні layer, тож
            transform/opacity нижче -- це не "стрибок", а перерахунок
            inline-стилю того самого DOM-вузла, і transition-[...] його плавно
            анімує від старої позиції в стосі до нової. z-index не анімується
            (властивість не інтерполюється), тому свіжа передня картка миттєво
            опиняється зверху, а колишня передня так само миттєво йде під низ
            (найменший z-index) -- і водночас "летить" по transform/opacity
            туди, у позицію найдальшого заднього шару. Разом це і дає ефект
            "картка перелітає під низ колоди". */}
        {[...layers].reverse().map(({ layer, item }) => {
          const isFront = layer === 0;

          return (
            <div
              key={item.id}
              style={{
                // Живе тестування (Андрій): попередні зсуви (10px/12px/5%)
                // були настільки дрібні, що анімація перемикання читалась як
                // "смикання", не як реальний рух картки -- збільшено, щоб
                // політ під низ колоди був видимим неозброєним оком.
                transform: `translate(${layer * 26}px, ${-layer * 30}px) scale(${1 - layer * 0.09})`,
                zIndex: layerCount - layer,
                opacity: 1 - layer * 0.16,
              }}
              className="absolute inset-0 transition-[transform,opacity] duration-500 ease-out"
            >
              {isFront ? (
                // D-121: передня картка -- це те, що повернув renderFront
                // (повний CardShell чи кнопка-назва залежно від виклику), не
                // власна кнопка DeckGrid.
                renderFront(item)
              ) : (
                <button
                  type="button"
                  onClick={() => setFrontIndex(items.indexOf(item))}
                  className="flex h-full w-full items-start rounded-card border border-border bg-surface-solid p-5 text-left font-display text-lg font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
                >
                  {item.name}
                </button>
              )}
            </div>
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
