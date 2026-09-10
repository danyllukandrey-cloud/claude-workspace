// Форма блоку-метрики (T28) -- screens.md SCR-05, AC-05/AC-07/AC-08.
//
// ISS-45: жодного fetch() і жодного імпорту з ports/ чи app/ цієї ж картки --
// HTTP-транспорт (Express) ще не підключено (T30). Дію "зберегти" ін'єктує
// викликач через `onSubmit` -- той самий DI-стиль, що вже в
// life-area-card/app/*.ts (callClaude, closeStructurePosition як параметри).
// Компонент сам керує локальним станом (loading/error/validation) навколо
// виклику цього пропа; реальний виклик POST /cards/{id}/metric-blocks (T22)
// підключить композиційний корінь пізніше (T30), не цей файл.
//
// Правило залежностей (plan/app/CLAUDE.md §Правило залежностей): ui -> лише
// domain цієї ж картки й shared/ui. Тут навіть domain не знадобився --
// обов'язковість label/unit це presentation-валідація форми (design-system.md
// §Interaction & writing conventions, "Validation": on-submit), а не доменний
// інваріант рахунку прогресу (той рахунок -- T6/T9 domain, застосовується на
// зворотній стороні картки, не тут).
//
// AC-05 (постійний процес без кінцевої дати): чекбокс "Постійний процес"
// ховає поле дати "До:" -- форма просто не збирає targetDate, коли isOngoing.
// AC-07 (агент допомагає знайти вимірну ціль): узгодження відбувається в чаті
// ДО цієї форми (life-area-card/app/create-metric-block.ts, коментар угорі) --
// тут "prefilled" це лише готові значення, що прийшли пропом `initialValues`.
// AC-08 (картка без блоку лишається декларативною): форма нічого не вимагає
// -- якщо її не відкрити/не надіслати, `onSubmit` не викликається жодного
// разу, і картка лишається без жодного блоку-метрики автоматично.
//
// Поле дати ("До:") і чекбокс "Постійний процес" -- свідомо звичайні нативні
// input type=date / input type=checkbox, поза спільним інвентарем
// TextField/NumberField/Button (design-system.md їх не описує).

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Banner, Button, NumberField, TextField } from '../../../shared/ui';

export interface MetricBlockFormValues {
  /** "Що рахуємо" -- обов'язкове. */
  label: string;
  /** Одиниця виміру -- обов'язкове. */
  unit: string;
  /** Ціль "X з N"; `null` -- не заповнено (взаємовиключно з isOngoing). */
  targetCount: number | null;
  /** "Постійний процес" -- без кінцевої дати (AC-05). */
  isOngoing: boolean;
  /** Кінцева дата у форматі `<input type="date">` (YYYY-MM-DD); `null` -- не заповнено. Завжди `null`, коли isOngoing. */
  targetDate: string | null;
}

export interface MetricBlockFormProps {
  /** Готові значення форми -- наприклад, попередньо узгоджені з агентом (AC-07). Відсутні -- форма порожня (default). */
  initialValues?: Partial<MetricBlockFormValues>;
  /** Створює блок-метрику; ін'єктується викликачем (DI) -- сама форма мережі не торкається. */
  onSubmit: (values: MetricBlockFormValues) => Promise<void>;
}

const EMPTY_VALUES: MetricBlockFormValues = {
  label: '',
  unit: '',
  targetCount: null,
  isOngoing: false,
  targetDate: null,
};

export function MetricBlockForm({ initialValues, onSubmit }: MetricBlockFormProps): JSX.Element {
  const [label, setLabel] = useState(initialValues?.label ?? EMPTY_VALUES.label);
  const [unit, setUnit] = useState(initialValues?.unit ?? EMPTY_VALUES.unit);
  const [targetCount, setTargetCount] = useState<number | null>(
    initialValues?.targetCount ?? EMPTY_VALUES.targetCount
  );
  const [isOngoing, setIsOngoing] = useState(initialValues?.isOngoing ?? EMPTY_VALUES.isOngoing);
  const [targetDate, setTargetDate] = useState<string | null>(
    initialValues?.targetDate ?? EMPTY_VALUES.targetDate
  );

  const [labelError, setLabelError] = useState<string | undefined>();
  const [unitError, setUnitError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextLabelError = label.trim() === '' ? 'Вкажіть, що рахуємо' : undefined;
    const nextUnitError = unit.trim() === '' ? 'Вкажіть одиницю' : undefined;
    setLabelError(nextLabelError);
    setUnitError(nextUnitError);
    if (nextLabelError || nextUnitError) {
      return; // validation state -- onSubmit навіть не викликається
    }

    setSubmitError(undefined);
    setIsSubmitting(true);
    try {
      await onSubmit({
        label,
        unit,
        targetCount,
        isOngoing,
        targetDate: isOngoing ? null : targetDate,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Не вдалось зберегти блок-метрику');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Новий блок-метрика</h2>
      {submitError && <Banner variant="error" text={submitError} />}
      {/* D-111 (docs/DECISIONS.md): порядок полів -- що рахуємо -> постійний
          процес одразу після -> одиниця -> ціль+дата в одному рядку. Живе
          тестування показало, що галочка "постійний процес" стосується саме
          того, ЩО рахуємо (є в нього кінець чи ні), тож логічно йде одразу
          за цим полем, не після одиниці й цілі. */}
      <TextField
        label="Що рахуємо:"
        value={label}
        onChange={setLabel}
        error={labelError}
        required
        hint="Наприклад: «тренування», «книги», «схудлі кілограми». Навіщо: це те, що агент бачитиме й пропонуватиме рахувати далі."
      />
      <label>
        <input
          type="checkbox"
          checked={isOngoing}
          onChange={(event) => setIsOngoing(event.target.checked)}
        />
        Постійний процес (без дати)
      </label>
      <TextField
        label="Одиниця:"
        value={unit}
        onChange={setUnit}
        error={unitError}
        required
        hint="Наприклад: «раз», «кг», «сторінка». Навіщо: одиниця показується поруч із кожним записом і ціллю."
      />
      <div>
        <NumberField
          label="Ціль:"
          value={targetCount}
          onChange={setTargetCount}
          hint="Наприклад: 12 (тренувань), 5 (кг). Навіщо: ціль визначає, коли прогрес по цьому блоку вважається завершеним."
        />
        {!isOngoing && (
          <label>
            До:
            <input
              type="date"
              value={targetDate ?? ''}
              onChange={(event) => setTargetDate(event.target.value === '' ? null : event.target.value)}
            />
          </label>
        )}
      </div>
      <Button label="Зберегти" type="submit" disabled={isSubmitting} />
    </form>
  );
}
