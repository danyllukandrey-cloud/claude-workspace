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
//
// Видалення блоку-метрики (DELETE .../metric-blocks/{id}): підтвердження
// через ввід слова -- опційний `requireTypedWord`. Коли переданий, під
// повідомленням з'являється текстове поле; головна кнопка підтвердження
// активна лише коли введений текст ТОЧНО збігається зі словом, Enter у полі
// підтверджує так само (обидва способи -- клік і Enter -- ведуть до того
// самого onConfirm). Без цього пропу компонент поводиться РІВНО як раніше --
// жодної зміни для наявних викликів (ArchiveCardDialog і будь-який інший).
//
// Живе тестування (Андрій): окрема кнопка-галочка поруч із полем вводу
// дублювала головну кнопку confirmLabel -- прибрана. Enter у полі й сама
// кнопка confirmLabel лишаються єдиними способами підтвердити.
//
// Живе тестування (Андрій): вікно підтвердження рендериться через
// createPortal напряму в document.body, а не в звичайному місці дерева.
// Причина -- CSS: backdrop-blur-xl на предку (CardShell.tsx) створює НОВИЙ
// containing block для нащадків із position:fixed (будь-який
// backdrop-filter/filter/transform на предку робить те саме, це поведінка
// специфікації CSS, не баг браузера). Без порталу fixed inset-0 нижче
// прив'язувався б не до вікна браузера, а до розміру картки-предка (яка й
// сама скролиться) -- вікно підтвердження їздило б разом із карткою замість
// бути по центру всього екрана. Портал обходить це раз і назавжди для ОБОХ
// викликачів (ArchiveCardDialog і ArchiveMetricBlockDialog), не лише для
// одного конкретного випадку.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  /**
   * Слово, яке користувач має ввести буквально (точний збіг), щоб розблокувати
   * підтвердження -- для дій, де випадковий клік коштує надто дорого (напр.
   * видалення блоку-метрики). Коли не передано -- поля вводу немає взагалі,
   * дія підтверджується звичайним кліком/Enter на кнопці, як і раніше.
   */
  requireTypedWord?: string;
}

export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled,
  requireTypedWord,
}: ConfirmDialogProps): JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // Review 2026-09-07, post-ship follow-up review (E remainder): role="dialog"
  // без aria-labelledby -- axe "aria-dialog-name" -- скрінрідер оголошував
  // безіменний діалог замість тексту підтвердження.
  const messageId = useId();
  const typedWordInputId = useId();
  const [typedWord, setTypedWord] = useState('');
  const isTypedWordRequired = requireTypedWord !== undefined;
  const typedWordMatches = !isTypedWordRequired || typedWord === requireTypedWord;
  const isConfirmDisabled = confirmDisabled || (isTypedWordRequired && !typedWordMatches);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return createPortal(
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
        {isTypedWordRequired && (
          <label htmlFor={typedWordInputId} className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            {`Введіть «${requireTypedWord}»`}
            <input
              id={typedWordInputId}
              type="text"
              value={typedWord}
              onChange={(event) => setTypedWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isConfirmDisabled) {
                  event.preventDefault();
                  onConfirm();
                }
              }}
              className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 font-sans text-sm font-normal text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
          </label>
        )}
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
            disabled={isConfirmDisabled}
            className="rounded-control bg-bad px-4 py-2.5 text-sm font-bold text-accent-ink shadow-btn transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
