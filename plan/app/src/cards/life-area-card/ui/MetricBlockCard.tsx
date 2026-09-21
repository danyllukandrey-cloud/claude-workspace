// Одна плитка прогресу на звороті картки (SCR-03, T26) -- показує ОДИН
// блок-метрику: bounded-ціль як частку (AC-09), capped-варіант зі
// значенням "понад ціль" окремо (AC-09b), або ongoing-варіант як накопичену
// кількість замість відсотка (AC-05). Позначку "очікує" додає окремо
// (AC-06/AC-11) -- сам компонент не знає ПРИЧИНУ pending (конфлікт пристроїв
// чи недоступність агента), лише факт "є запис, що ще не порахований".
//
// D-126 -- явний, звірений виняток із D-120: D-120 початково казав "тут немає
// готового дискретного статусу -- нейтральний ink, БЕЗ світлофора (good/warn/
// bad), той зарезервовано для EntryHistoryList, де є справжній entry.status".
// Компактний рестайл нижче (задача 7) додав кольорову рамку САМЕ за порогом
// progress.share -- Андрій попросив це явно, і docs/DECISIONS.md фіксує це
// як свідомий виняток (D-126), звірений іще раз при D-128 (прибрати
// фірмовий колір повністю) -- лишається чинним. ongoing-варіант (нема share,
// нема чого порогувати) і далі БЕЗ кольору світлофора.
import type { MetricBlockViewModel } from './types';

export interface MetricBlockCardProps {
  block: MetricBlockViewModel;
  /**
   * Видалення (архівація) цього блоку-метрики -- DELETE
   * .../metric-blocks/{id}. Той самий опційний патерн, що onCreateMetricBlock
   * у CardBack: без пропу кнопка "×" не рендериться взагалі. Сам виклик
   * діалогу підтвердження ("введіть «видалити»") -- на рівень вище
   * (CardBack.tsx), тут лише факт кліку.
   */
  onDelete?: () => void;
  /**
   * CH-03 (docs/features/life-area-card/changes.md): відкриває редагування
   * блоку -- перейменування, зміна налаштувань, перенесення на іншу картку.
   * Той самий опційний патерн, що onDelete: без пропу олівець не рендериться.
   * Сам вигляд редагування -- на рівень вище (CardBack.tsx), тут лише факт кліку.
   */
  onEdit?: () => void;
  /**
   * CH-16 (docs/features/life-area-card/changes.md): розгортає форму
   * "Додати/відняти показник" під цим блоком -- швидкий запис без участі
   * агента-чату. Той самий опційний патерн, що onDelete/onEdit: без пропу
   * кнопка "+" взагалі не рендериться. Сама форма -- на рівень вище
   * (CardBack.tsx), тут лише факт кліку.
   */
  onQuickAdjust?: () => void;
  /**
   * CH-02 (docs/features/life-area-card/changes.md): true, коли картка -- в
   * режимі "стан без вимірювань" -- справжній HTML `disabled` на "×"/"✎", не
   * лише CSS `pointer-events-none` на предку (CardBack.tsx): pointer-events
   * блокує мишу/дотик, але НЕ блокує Enter/Space-активацію фокусованої
   * кнопки клавіатурою -- code review 2026-09-19 (CH-02/CH-03 combined diff).
   */
  disabled?: boolean;
}

/**
 * Колір рамки/тексту відсотка за часткою виконання -- той самий словник
 * кольору (border/bg/10/text), що Banner.tsx, без глянцю `.chip-gloss`
 * (theme.css) -- глянець лишається за EntryHistoryList.tsx, де колір іде від
 * СПРАВЖНЬОГО entry.status, не порогу над числом.
 */
function progressToneClasses(share: number): string {
  if (share >= 0.7) return 'border-good/25 bg-good/10 text-good';
  if (share >= 0.3) return 'border-warn/25 bg-warn/10 text-warn';
  return 'border-bad/25 bg-bad/10 text-bad';
}

interface RoundIconButtonProps {
  ariaLabel: string;
  onClick: () => void;
  disabled: boolean;
  glyph: string;
  /** Позиція (absolute-кут чи grid-слот) + тон кольору -- єдине, чим різняться "×"/"✎"/"+" нижче. */
  className: string;
}

/**
 * /simplify review-fix: спільна "чарунка" для трьох майже ідентичних кнопок
 * нижче ("×" видалення, "✎" редагування, "+" швидкого +/-) -- різнились
 * лише позицією (absolute-кут vs grid-слот) і кольоровим тоном, решта класів
 * (розмір/форма/disabled-стан) повторювалась тричі буквально.
 */
function RoundIconButton({ ariaLabel, onClick, disabled, glyph, className }: RoundIconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-5 w-5 items-center justify-center rounded-full border shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {glyph}
    </button>
  );
}

export function MetricBlockCard({ block, onDelete, onEdit, onQuickAdjust, disabled = false }: MetricBlockCardProps): JSX.Element {
  const { progress } = block;

  // CH-16: "+" по центру, між назвою й показником -- grid-cols-[1fr_auto_1fr]
  // (не flex justify-between) тримає показник у ПРАВІЙ колонці незалежно від
  // того, чи рендериться сама кнопка: без onQuickAdjust середня колонка все
  // одно займає місце (порожній <span/>), інакше показник з'їжджав би в
  // середню колонку замість правої.
  const quickAdjustSlot = onQuickAdjust ? (
    <RoundIconButton
      ariaLabel={`Додати або відняти показник «${block.label}»`}
      onClick={onQuickAdjust}
      disabled={disabled}
      glyph="+"
      // Живе тестування 2026-09-21 (Андрій): "зроби кружечок плюсу зеленим"
      // -- той самий тональний словник (border-good/25 bg-good/10 text-good),
      // що Banner.tsx's success-варіант/progressToneClasses вище, замість
      // нейтрального border-border + зелений лише на hover.
      className="justify-self-center border-good/25 bg-good/10 text-sm font-bold leading-none text-good hover:bg-good/20 disabled:hover:bg-good/10"
    />
  ) : (
    <span />
  );

  // Bug fix 2026-09-21 (живе тестування, Андрій: "відступи тексту від
  // значень... гігантські") -- підписи нижче (постійний процес/+X понад
  // ціль/очікує перевірки) раніше мали ВЛАСНИЙ mt-1 ПОВЕРХ gap-1 контейнера
  // нижче -- у flex/grid margin і gap НЕ схлопуються (на відміну від margin
  // між звичайними block-елементами), тож відступ фактично подвоювався
  // (4+4=8px). Прибрано mt-1 -- єдине джерело відступу тепер gap-1.
  return (
    <div className="relative flex flex-col gap-1 rounded-card border border-border bg-surface p-2.5">
      {/* Кнопка "×" -- правий верхній кут, НАД зоною відсотка (`-top`/`-right`
          виносять її трохи за межу картки, поверх кутка, а не в один ряд із
          відсотком нижче). absolute вимагає relative на контейнері (клас
          вище). Той самий опційний-проп патерн, що форма "+ Додати
          блок-метрику" в CardBack -- без onDelete кнопки взагалі немає в DOM.
          `disabled` -- справжній HTML-атрибут (не лише CSS): блокує і
          мишу/дотик, і Enter/Space з клавіатури. */}
      {onDelete && (
        <RoundIconButton
          ariaLabel={`Видалити метрику «${block.label}»`}
          onClick={onDelete}
          disabled={disabled}
          glyph="×"
          className="absolute -right-1.5 -top-1.5 border-border bg-surface-solid text-xs font-bold leading-none text-ink-muted hover:border-bad/40 hover:text-bad disabled:hover:border-border disabled:hover:text-ink-muted"
        />
      )}
      {/* CH-03: олівець -- правий нижній кут блоку (поруч із хрестиком
          видалення, який стоїть у правому верхньому). Той самий опційний-проп
          патерн, що "×" вище -- без onEdit узагалі немає в DOM. */}
      {onEdit && (
        <RoundIconButton
          ariaLabel={`Редагувати метрику «${block.label}»`}
          onClick={onEdit}
          disabled={disabled}
          glyph="✎"
          className="absolute -bottom-1.5 -right-1.5 border-border bg-surface-solid text-xs leading-none text-ink-muted hover:border-ink/40 hover:text-ink disabled:hover:border-border disabled:hover:text-ink-muted"
        />
      )}
      {progress.kind === 'ongoing' ? (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2">
            <span className="text-sm font-medium text-ink">{block.label}</span>
            {quickAdjustSlot}
            <span className="justify-self-end font-display text-sm font-semibold text-ink">
              {progress.accumulated} {block.unit}
            </span>
          </div>
          <p className="text-xs font-medium leading-relaxed text-ink-muted">постійний процес</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2">
            <span className="text-sm font-medium text-ink">{block.label}</span>
            {quickAdjustSlot}
            <span
              className={`justify-self-end inline-flex items-center rounded-full border px-2 py-0.5 font-display text-sm font-semibold ${progressToneClasses(progress.share)}`}
            >
              {Math.round(progress.share * 100)}%
            </span>
          </div>
          {progress.overGoal > 0 && (
            <p className="text-xs font-medium leading-relaxed text-ink-muted">
              +{progress.overGoal} {block.unit} понад ціль
            </p>
          )}
        </>
      )}
      {block.hasPendingEntry && (
        <p className="text-xs font-medium leading-relaxed text-ink-muted">Запис очікує перевірки агента</p>
      )}
    </div>
  );
}
