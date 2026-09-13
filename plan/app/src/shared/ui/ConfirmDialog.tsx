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

import { useEffect, useId, useRef } from 'react';

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
  // Review 2026-09-07, post-ship follow-up review (E remainder): role="dialog"
  // без aria-labelledby -- axe "aria-dialog-name" -- скрінрідер оголошував
  // безіменний діалог замість тексту підтвердження.
  const messageId = useId();

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    // D-120: сама дія завжди "з наслідками, що не скасовуються одним кліком"
    // (комент над компонентом вище) -- підтвердження навмисно у кольорі
    // світлофора "bad", матовим суцільним заповненням (не .chip-gloss --
    // глянець лишається тільки за статусом виміру, тут інший контекст).
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={messageId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="flex w-full max-w-sm flex-col gap-5 rounded-card border border-border bg-surface-solid p-6 shadow-soft"
      >
        <p id={messageId} className="text-sm font-medium text-ink">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            ref={cancelButtonRef}
            className="rounded-control border border-border px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-border"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="rounded-control bg-bad px-4 py-2.5 text-sm font-bold text-accent-ink shadow-btn transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
