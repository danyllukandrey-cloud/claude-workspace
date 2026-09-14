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
// означеної висоти-предка поводяться так само, як і раніше. `overflow-y-auto`
// на внутрішньому блоці -- вміст (особливо зворот із багатьма блоками-
// метриками) прокручується всередині фіксованої висоти картки, замість того
// щоб продавлювати її вниз.
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
      <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-soft backdrop-blur-xl">
        {isFlipped ? back : front}
      </div>
    </div>
  );
}
