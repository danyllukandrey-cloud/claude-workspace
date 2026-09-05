// ЗАГОТОВКА (T24). Підтвердження дії з наслідками, що не скасовуються одним кліком
// (наприклад — архівація картки).
//
// Повідомлення + дві дії (підтвердити/скасувати), кожна — окремий callback-проп.
// Ніколи confirm() — блокує інтерфейс (plan/app/CLAUDE.md §Конвенції).

export interface ConfirmDialogProps {
  /** Що саме підтверджуємо. */
  message: string;
  /** Підпис кнопки підтвердження. */
  confirmLabel: string;
  /** Підпис кнопки скасування. */
  cancelLabel: string;
  /** Викликається при підтвердженні дії. */
  onConfirm: () => void;
  /** Викликається при скасуванні дії. */
  onCancel: () => void;
}

export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  return (
    <div>
      <p>{message}</p>
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}
