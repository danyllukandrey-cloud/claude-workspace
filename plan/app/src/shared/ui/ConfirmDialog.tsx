// Підтвердження дії з наслідками, що не скасовуються одним кліком (T24)
// (наприклад — архівація картки).
//
// Повідомлення + дві дії (підтвердити/скасувати), кожна — окремий callback-проп.
// Ніколи confirm() — блокує інтерфейс (plan/app/CLAUDE.md §Конвенції).
//
// Review 2026-09-07 E (T52): базова доступність модального діалогу --
// role="dialog"+aria-modal (щоб допоміжні технології знали, що це модалка,
// не звичайний блок тексту), початковий фокус на "Скасувати" (безпечний
// дефолт для деструктивної дії -- випадковий Enter одразу після відкриття
// не підтверджує), Escape закриває через onCancel (той самий шлях, що
// кнопка "Скасувати", НЕ окремий колбек). confirmDisabled -- опційний,
// викликач (ArchiveCardDialog) вмикає його на час виконання onArchive,
// щоб подвійний клік не викликав дію вдруге.

import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  /** Що саме підтверджуємо. */
  message: string;
  /** Підпис кнопки підтвердження. */
  confirmLabel: string;
  /** Підпис кнопки скасування. */
  cancelLabel: string;
  /** Викликається при підтвердженні дії. */
  onConfirm: () => void;
  /** Викликається при скасуванні дії (і при Escape -- той самий шлях). */
  onCancel: () => void;
  /** Review 2026-09-07 E: вимикає кнопку підтвердження -- захист від подвійного сабміту, поки викликач чекає на асинхронну дію. */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled,
}: ConfirmDialogProps): JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p>{message}</p>
      <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </button>
      <button type="button" onClick={onCancel} ref={cancelButtonRef}>
        {cancelLabel}
      </button>
    </div>
  );
}
