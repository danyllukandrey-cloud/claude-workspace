// Каркас картки, що перевертається — лицьова / зворотна сторона (T24).
//
// Показує front, коли isFlipped=false, і back, коли isFlipped=true.
// Одночасно на екрані лише одна сторона — саме тому "перевертається", а не
// "розгортається": попередній вміст зникає, коли показано інший.
import type { ReactNode } from 'react';

export interface CardShellProps {
  /** Вміст лицьової сторони (наприклад — введення даних). */
  front: ReactNode;
  /** Вміст зворотної сторони (наприклад — дашборд прогресу). */
  back: ReactNode;
  /** Яка сторона показана: false — лицьова, true — зворотна. */
  isFlipped: boolean;
}

// D-120: "сфумато" -- розмита кольорова підкладка (--color-blob-*) видна
// крізь напівпрозору матову картку (backdrop-blur). Три плями лишаються
// нерухомими позаду картки незалежно від isFlipped -- перевертається лише
// вміст, підкладка це одна "аура" картки, не два різних фони.
//
// `h-full` (D-121, живе тестування -- "картки мають займати 85% висоти
// сторінки"): якщо предок має означену висоту (DeckGrid.tsx, картка колоди)
// -- CardShell розтягується на всю неї; де предок сам content-сайзиться
// (ArchiveScreen.tsx card-view -- явних змін тут не було) `height: 100%` від
// `height: auto` резолвиться в `auto` (сам CSS-спек), тож існуючі виклики без
// означеної висоти-предка поводяться так само, як і раніше.
//
// Живе тестування (Андрій, баг 2): `overflow-y-auto` НЕ тут -- раніше стояв
// на цьому самому контейнері, що містив УВЕСЬ вміст (front/back) РАЗОМ із
// кнопкою "перегорнути" (mt-auto), тож при великому контенті скролився
// весь стовпчик цілком, разом із кнопкою, замість того щоб кнопка лишалась
// прикріпленою внизу. Тепер скрол і прикріплена кнопка -- на РІЗНИХ рівнях:
// кожен викликач (CardFace.tsx/CardBack.tsx) сам обгортає СВІЙ контент (без
// кнопки) у `flex-1 min-h-0 overflow-y-auto`, а кнопка -- сестринський
// елемент ПІСЛЯ цієї обгортки, природно лишається внизу через flex-1 на
// сусідові. Виклики без власної кнопки-футера (ArchiveScreen.tsx card-view)
// переносять той самий `flex-1 min-h-0 overflow-y-auto` патерн на свій
// єдиний вміст, щоб не втратити скрол.
export function CardShell({ front, back, isFlipped }: CardShellProps): JSX.Element {
  return (
    <div className="relative isolate h-full p-1">
      <div
        aria-hidden="true"
        className="absolute -left-10 -top-14 -z-10 h-56 w-56 rounded-full bg-blob-a opacity-90 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-12 -right-8 -z-10 h-48 w-48 rounded-full bg-blob-b opacity-90 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute right-1/4 top-1/2 -z-10 h-36 w-36 rounded-full bg-blob-c opacity-90 blur-3xl"
      />
      <div className="flex h-full flex-col gap-5 rounded-card border border-border bg-surface p-6 shadow-soft backdrop-blur-xl">
        {isFlipped ? back : front}
      </div>
    </div>
  );
}
