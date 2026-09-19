// SCR-06 — Підтвердження архівації (T29): ConfirmDialog (reused, T24) для
// підтвердження м'якої архівації картки -- AC-16 (spec.md §5): архівація
// завжди йде через підтвердження, картка ніколи не видаляється фізично,
// лише позначається archived і зникає з колоди й розкладки Структури,
// лишаючись відновлюваною.
//
// ISS-45: у репозиторії ще немає підключеного HTTP-транспорту -- реальний
// DELETE /cards/{id} (ports, T21) підключає майбутня задача T30. Тому цей
// компонент НЕ робить fetch() і не імпортує нічого з ports/ чи app/ цієї
// картки -- дію "архівувати" отримує ІН'ЄКТОВАНОЮ пропсою onArchive, що
// повертає Promise<void>. Той самий DI-стиль (dependency injection --
// залежність передають ззовні, а не створюють усередині), що вже в
// plan/app/src/cards/life-area-card/app/archive-card.ts (closeStructurePosition
// як параметр). Компонент сам керує локальним станом (error) навколо виклику.
//
// Правило залежностей (plan/app/CLAUDE.md): ui -> domain своєї картки і
// shared/ui. Тут домен не потрібен -- лише текст підтвердження й обробка
// помилки, тож імпортується тільки shared/ui.

import { useState } from 'react';
import { Banner, ConfirmDialog } from '../../../shared/ui';

export interface ArchiveCardDialogProps {
  /** Назва картки -- підставляється в текст підтвердження. */
  cardName: string;
  /** Підтвердження архівації. Реальний DELETE /cards/{id} робить викликач. */
  onArchive: () => Promise<void>;
  /** Скасування -- onArchive НЕ викликається. */
  onCancel: () => void;
}

export function ArchiveCardDialog({
  cardName,
  onArchive,
  onCancel,
}: ArchiveCardDialogProps): JSX.Element {
  // error === null -> default стан (SCR-06). Непорожній рядок -> error стан
  // (404 card.not_found / мережева помилка), рендериться Banner.
  const [error, setError] = useState<string | null>(null);
  // Review 2026-09-07 E (T52): захист від подвійного сабміту -- швидкий
  // повторний клік по "Архівувати", поки перший DELETE ще в польоті, раніше
  // викликав onArchive вдруге. Скидається і на успіх (теоретично), і на
  // невдачу -- інакше провалена спроба назавжди заблокувала б retry.
  const [isArchiving, setIsArchiving] = useState(false);

  const handleConfirm = (): void => {
    if (isArchiving) return;
    setError(null);
    setIsArchiving(true);
    onArchive()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Не вдалося архівувати картку';
        setError(message);
      })
      .finally(() => setIsArchiving(false));
  };

  return (
    <div>
      <ConfirmDialog
        message={`Архівувати картку «${cardName}»? Картка зникне з колоди й розкладки Структури. Дані лишаються — можна відновити пізніше.`}
        confirmLabel="Архівувати"
        cancelLabel="Скасувати"
        onConfirm={handleConfirm}
        onCancel={onCancel}
        confirmDisabled={isArchiving}
      />
      {/* D-120: ConfirmDialog уже несе свій fixed-overlay (inset-0, z-50) --
          другий overlay навколо нього не додаємо. Ця обгортка лише
          виносить Banner ПОВЕРХ того самого overlay (z-[60]), біля низу
          екрана, без власного backdrop -- інакше Banner лишився б у звичайному
          потоці документа під напівпрозорою підкладкою модалки й був би
          практично не видимий користувачу. */}
      {error !== null && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div className="w-full max-w-sm">
            <Banner variant="error" text={error} />
          </div>
        </div>
      )}
    </div>
  );
}
