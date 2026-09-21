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
import type { CardTrackingMode } from '../domain/card';

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
  /**
   * CH-10 (docs/features/life-area-card/changes.md, живе тестування
   * 2026-09-21): режим картки визначає, ЯКІ поля форма взагалі показує --
   * 'ongoing' ховає чекбокс "Постійний процес" (уже зайвий, картка й так
   * каже, що процес постійний -- та сама назва в обох місцях плутала) і
   * ціль/дату повністю, submit завжди шле isOngoing:true/targetCount:null/
   * targetDate:null. 'goals' (за замовчуванням) -- повна форма, як і
   * раніше. Картки в режимі 'state' сюди взагалі не доходять (CardBack.tsx
   * не рендерить форму блоку-метрики в цьому режимі).
   */
  // Review-fix: перевикористовує CardTrackingMode (Exclude 'state') замість
  // окремого локального union -- дві паралельні "мови" для того самого
  // поняття (тут 'ongoing'/'goals', там 'state'/'ongoing'/'goals') інакше
  // синхронізуються вручну без жодного зв'язку типів.
  mode?: Exclude<CardTrackingMode, 'state'>;
  /**
   * Живе тестування 2026-09-21 (Андрій): без цього пропу нема способу
   * вийти з форми СТВОРЕННЯ нового блоку без збереження -- лише
   * "Зберегти". Опційний, той самий "без пропу афорданс не рендериться"
   * принцип, що решта опційних дій цього продукту -- форма редагування
   * наявного блоку вже має власне "Закрити" на рівні панелі (CardBack.tsx),
   * цей проп їй не потрібен.
   */
  onCancel?: () => void;
  /**
   * Bug fix 2026-09-21 (живе тестування, Андрій зі скріншотом): "дубль,
   * слово редагування тут лишнє" -- панель редагування наявного блоку
   * (CardBack.tsx) уже має власний заголовок "Редагування «label»" НАД
   * цією формою (з назвою блоку, на відміну від голого "Редагування" тут).
   * За замовчуванням true -- форма створення нового блоку (CardBack.tsx,
   * інший виклик) НЕ має власного зовнішнього заголовка, їй цей потрібен.
   */
  showHeading?: boolean;
}

const EMPTY_VALUES: MetricBlockFormValues = {
  label: '',
  unit: '',
  targetCount: null,
  isOngoing: false,
  targetDate: null,
};

export function MetricBlockForm({ initialValues, onSubmit, mode = 'goals', onCancel, showHeading = true }: MetricBlockFormProps): JSX.Element {
  // CH-08 (docs/features/life-area-card/changes.md, живе тестування
  // 2026-09-21): заголовок форми -- "Редагування" саме коли відкрито через
  // олівець наявної метрики (initialValues переданий), "Новий блок-метрика"
  // лише для справді нової.
  const isEditing = initialValues !== undefined;
  const isOngoingMode = mode === 'ongoing';
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
      await onSubmit(
        isOngoingMode
          ? { label, unit, targetCount: null, isOngoing: true, targetDate: null }
          : { label, unit, targetCount, isOngoing, targetDate: isOngoing ? null : targetDate },
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Не вдалось зберегти блок-метрику');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface-solid p-4"
    >
      {showHeading && (
        <h2 className="font-display text-lg font-bold leading-relaxed text-ink">
          {isEditing ? 'Редагування' : 'Новий блок-метрика'}
        </h2>
      )}
      {submitError && <Banner variant="error" text={submitError} />}
      {/* D-111 (docs/DECISIONS.md): порядок полів -- що рахуємо -> постійний
          процес одразу після -> одиниця -> ціль+дата в одному рядку. Живе
          тестування показало, що галочка "постійний процес" стосується саме
          того, ЩО рахуємо (є в нього кінець чи ні), тож логічно йде одразу
          за цим полем, не після одиниці й цілі. */}
      <TextField
        label="Що рахуємо/вимірюємо:"
        value={label}
        // CH-08 (живе тестування 2026-09-21): помилка гасне одразу, як
        // користувач почав виправляти поле -- раніше чекала наступного
        // сабміту, тож лишалась червоною навіть коли текст уже введено.
        onChange={(value) => {
          setLabel(value);
          if (labelError) setLabelError(undefined);
        }}
        error={labelError}
        required
        hint="Наприклад: «тренування», «книги», «схудлі кілограми». Навіщо: це те, що агент бачитиме й пропонуватиме рахувати далі."
      />
      {/* CH-10: чекбокс лише в режимі 'goals' -- у 'ongoing' картка вже сама
          каже, що процес постійний (та сама назва зверху й тут плутала). */}
      {!isOngoingMode && (
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={isOngoing}
            onChange={(event) => setIsOngoing(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Постійний процес з метриками (без дати)
        </label>
      )}
      <TextField
        label="Одиниця:"
        value={unit}
        // CH-08: той самий фікс, що поле вище -- помилка гасне одразу на вводі.
        onChange={(value) => {
          setUnit(value);
          if (unitError) setUnitError(undefined);
        }}
        error={unitError}
        required
        hint="Наприклад: «раз», «кг», «сторінка». Навіщо: одиниця показується поруч із кожним записом і ціллю."
      />
      {/* CH-10: ціль/дата лише в режимі 'goals' -- 'ongoing' блоки за
          визначенням без цілі й без кінцевої дати. */}
      {!isOngoingMode && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px] flex-1">
            <NumberField
              label="Ціль:"
              value={targetCount}
              onChange={setTargetCount}
              hint="Наприклад: 12 (тренувань), 5 (кг). Навіщо: ціль визначає, коли прогрес по цьому блоку вважається завершеним."
            />
          </div>
          {!isOngoing && (
            <label className="flex min-w-[140px] flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
              До:
              <input
                type="date"
                value={targetDate ?? ''}
                onChange={(event) => setTargetDate(event.target.value === '' ? null : event.target.value)}
                className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm font-normal text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
              />
            </label>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        {onCancel && <Button label="На зад" type="button" onClick={onCancel} disabled={isSubmitting} />}
        <Button label="Зберегти" type="submit" disabled={isSubmitting} />
      </div>
    </form>
  );
}
