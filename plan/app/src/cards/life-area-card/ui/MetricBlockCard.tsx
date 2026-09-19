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

export function MetricBlockCard({ block, onDelete, onEdit, disabled = false }: MetricBlockCardProps): JSX.Element {
  const { progress } = block;

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
        <button
          type="button"
          aria-label={`Видалити метрику «${block.label}»`}
          onClick={onDelete}
          disabled={disabled}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-solid text-xs font-bold leading-none text-ink-muted shadow-soft transition-colors hover:border-bad/40 hover:text-bad disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-ink-muted"
        >
          ×
        </button>
      )}
      {/* CH-03: олівець -- правий нижній кут блоку (поруч із хрестиком
          видалення, який стоїть у правому верхньому). Той самий опційний-проп
          патерн, що "×" вище -- без onEdit узагалі немає в DOM. */}
      {onEdit && (
        <button
          type="button"
          aria-label={`Редагувати метрику «${block.label}»`}
          onClick={onEdit}
          disabled={disabled}
          className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-solid text-xs leading-none text-ink-muted shadow-soft transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-ink-muted"
        >
          ✎
        </button>
      )}
      {progress.kind === 'ongoing' ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">{block.label}</span>
            <span className="font-display text-sm font-semibold text-ink">
              {progress.accumulated} {block.unit}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium leading-relaxed text-ink-muted">постійний процес</p>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">{block.label}</span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-display text-sm font-semibold ${progressToneClasses(progress.share)}`}
            >
              {Math.round(progress.share * 100)}%
            </span>
          </div>
          {progress.overGoal > 0 && (
            <p className="mt-1 text-xs font-medium leading-relaxed text-ink-muted">
              +{progress.overGoal} {block.unit} понад ціль
            </p>
          )}
        </>
      )}
      {block.hasPendingEntry && (
        <p className="mt-1 text-xs font-medium leading-relaxed text-ink-muted">Запис очікує перевірки агента</p>
      )}
    </div>
  );
}
