// UI: SCR-04 -- форма створення картки (T27).
//
// AC-02 (spec.md §5): спроба зберегти без назви блокує створення й пояснює,
// що назва обов'язкова -- ДО будь-якого виклику onCreate. Перевірку й текст
// повідомлення перевикористано з domain/card.ts:assertNonEmpty (той самий
// код 'card.name_required', що createCard() кине пізніше на бекенді) --
// один рядок правди, а не власне дубльоване формулювання (T27 should-fix).
//
// ISS-45 (docs/ISSUES.md): у репозиторії ще немає підключеного HTTP-
// транспорту -- компонент НЕ робить fetch і НЕ імпортує ports/ чи app/ цієї ж
// картки (правило залежностей, plan/app/CLAUDE.md). Дію "створити" отримує
// ЗЗОВНІ як ін'єктовану проп-функцію, що повертає Promise -- той самий DI-
// стиль, що callClaude/closeStructurePosition у cards/life-area-card/app/*.ts.
// Компонент сам керує локальним станом навколо цього виклику: default (порожнє
// поле) -> validation (порожня назва при спробі зберегти) -> saving (Promise
// в польоті) -> error (Promise відхилено) чи назад у default (успіх).

import { useState, type FormEvent } from 'react';
import { Banner } from '../../../shared/ui/Banner';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';
import { TextField } from '../../../shared/ui/TextField';
import { assertNonEmpty, CardValidationError } from '../domain/card';

const SAVE_FAILED_MESSAGE = 'Не вдалося зберегти картку. Перевірте зв’язок і спробуйте ще раз.';

export interface CreateCardFormInput {
  name: string;
}

export interface CreateCardFormProps {
  /**
   * Ін'єкція виклику POST /cards (T21, contracts/openapi.yaml). Компонент не
   * знає й не має знати, що саме всередині -- fetch, mock у тесті, будь-що.
   */
  onCreate: (input: CreateCardFormInput) => Promise<void>;
  /**
   * Необов'язковий вихід без збереження (закриття форми). Коли передано --
   * рендериться друга кнопка "Скасувати", яка викликає лише цей проп, без
   * жодного виклику onCreate.
   */
  onCancel?: () => void;
}

export function CreateCardForm({ onCreate, onCancel }: CreateCardFormProps): JSX.Element {
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  function handleNameChange(value: string): void {
    setName(value);
    if (validationError) {
      setValidationError(undefined);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    try {
      assertNonEmpty(trimmedName, 'card.name_required', 'Назва картки обовʼязкова');
    } catch (error) {
      if (error instanceof CardValidationError) {
        setValidationError(error.message);
        return;
      }
      throw error;
    }

    setValidationError(undefined);
    setSubmitError(undefined);
    setSaving(true);

    try {
      await onCreate({ name: trimmedName });
      setSaving(false);
      setName('');
    } catch (error) {
      setSaving(false);
      // Review 2026-09-07 E (T52): раніше КОЖНЕ відхилення показувало той
      // самий узагальнений текст, незалежно від того, що насправді сказав
      // сервер -- той самий фікс, що вже застосований у ArchiveCardDialog/
      // MetricBlockCard (T49): реальний error.message, якщо він є.
      setSubmitError(error instanceof Error ? error.message : SAVE_FAILED_MESSAGE);
    }
  }

  return (
    // D-120: TextField/Banner/Spinner/Button уже самі стилізовані й не
    // приймають className -- тут стилізуються лише сторінка-обгортка, сама
    // картка форми (той самий вигляд, що в ConfirmDialog.tsx) і групування
    // кнопок "Створити"/"Скасувати" поряд (D-111).
    <div className="flex min-h-screen flex-col bg-bg px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-card border border-border bg-surface-solid p-6 shadow-soft"
      >
        <h2 className="font-display text-lg font-bold leading-relaxed text-ink">Нова картка</h2>
        {submitError && <Banner variant="error" text={submitError} />}
        <TextField label="Назва" value={name} onChange={handleNameChange} error={validationError} />
        {saving ? (
          <Spinner />
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" label="Створити" />
            {onCancel && <Button type="button" label="Скасувати" onClick={onCancel} />}
          </div>
        )}
      </form>
    </div>
  );
}
