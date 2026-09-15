// Підтвердження видалення (архівації) блоку-метрики -- ConfirmDialog
// (reused, T24) з requireTypedWord="видалити": користувач має буквально
// ввести слово "видалити" й підтвердити (Enter у полі або сама кнопка
// confirmLabel), перш ніж DELETE .../metric-blocks/{id} узагалі йде -- той
// самий рівень захисту, що й ArchiveCardDialog.tsx, лише посилений вводом
// слова (блок-метрику разом із його історією прогресу відновити не так
// очевидно, як картку, D-120 коментар вище ArchiveCardDialog розрізняє
// "просте підтвердження" й "підтвердження, посилене вводом слова" -- нове
// тут).
//
// Фіксований контракт (паралельний бекенд-агент, не бачить цей файл):
// DELETE /api/v1/cards/{cardId}/metric-blocks/{metricBlockId} -> 200,
// MetricBlock DTO зі status: "archived"; 404 card.not_found -- та сама
// угода, що вже встановив transfer-metric-block (ISS-30). Сам HTTP-виклик
// живе в main.tsx (archiveMetricBlock) -- цей компонент лише ін'єктовану
// onArchive: () => Promise<void>, той самий DI-стиль, що ArchiveCardDialog.
//
// Правило залежностей (plan/app/CLAUDE.md): ui -> domain своєї картки і
// shared/ui. Тут домен не потрібен -- лише текст підтвердження й обробка
// помилки, тож імпортується тільки shared/ui.

import { useState } from 'react';
import { Banner, ConfirmDialog } from '../../../shared/ui';

const CONFIRM_WORD = 'видалити';

export interface ArchiveMetricBlockDialogProps {
  /** Назва блоку-метрики -- підставляється в текст підтвердження. */
  metricBlockLabel: string;
  /** Підтвердження видалення. Реальний DELETE .../metric-blocks/{id} робить викликач. */
  onArchive: () => Promise<void>;
  /** Скасування -- onArchive НЕ викликається. */
  onCancel: () => void;
}

export function ArchiveMetricBlockDialog({
  metricBlockLabel,
  onArchive,
  onCancel,
}: ArchiveMetricBlockDialogProps): JSX.Element {
  // error === null -> default стан. Непорожній рядок -> error стан (404
  // card.not_found / мережева помилка), рендериться Banner -- той самий підхід, що ArchiveCardDialog.
  const [error, setError] = useState<string | null>(null);
  // Той самий захист від подвійного сабміту, що ArchiveCardDialog.isArchiving
  // -- швидкий повторний клік/Enter, поки перший DELETE ще в польоті, не
  // викликає onArchive вдруге. Скидається і на успіх (теоретично), і на
  // невдачу -- інакше провалена спроба назавжди заблокувала б retry.
  const [isArchiving, setIsArchiving] = useState(false);

  const handleConfirm = (): void => {
    if (isArchiving) return;
    setError(null);
    setIsArchiving(true);
    onArchive()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Не вдалося видалити метрику';
        setError(message);
      })
      .finally(() => setIsArchiving(false));
  };

  return (
    <div>
      <ConfirmDialog
        message={`Видалити метрику «${metricBlockLabel}»? Введіть «${CONFIRM_WORD}» і підтвердіть.`}
        confirmLabel="Видалити"
        cancelLabel="Скасувати"
        onConfirm={handleConfirm}
        onCancel={onCancel}
        confirmDisabled={isArchiving}
        requireTypedWord={CONFIRM_WORD}
      />
      {/* D-120 (той самий підхід, що ArchiveCardDialog): ConfirmDialog уже несе
          свій fixed-overlay (inset-0, z-50) -- другий overlay навколо нього не
          додаємо. Ця обгортка лише виносить Banner ПОВЕРХ того самого overlay
          (z-[60]), біля низу екрана, без власного backdrop. */}
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
