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

export function CardShell({ front, back, isFlipped }: CardShellProps): JSX.Element {
  return <div>{isFlipped ? back : front}</div>;
}
