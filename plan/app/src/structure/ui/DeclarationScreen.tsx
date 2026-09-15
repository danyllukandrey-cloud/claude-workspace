// SCR-01 — Декларація (spec.md AC-09, AC-10, AC-11, AC-11b).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що CardDetailScreen/
// ArchiveCardDialog): loadStructure/onSave — ін'єктовані пропи-функції,
// жодного fetch() тут. Реальний HTTP-транспорт (ports/) підключає
// викликач цього компонента.
//
// Вимоги 14/15 (Андрій, чат) — ПЛОСКА модель: замінено дворівневий вибір
// (LAYOUT_MODE_OPTIONS "Одна картка"/"Вільно"/"За логікою" + умовний
// LOGIC_VARIANT_OPTIONS, що показувався лише при "За логікою") на ОДИН
// список із 5 пігулок. "Одна картка" скасована повністю — навіщо режим
// "одна картка", якщо картку й так можна створити рівно одну (вимога 14).
// Три колишні підвиди "за логікою" (D-83) стали топ-рівневими режимами
// нарівні з "Вільна розкладка" (перейменування підпису колишнього "Вільно",
// той самий режим) і новим "Готово до розкладання" (вимога 15).
//
// AC-11/AC-11b: зміна layoutMode, коли вже є розкладені картки
// (hasArrangedCards), скидає розташування карток (T5/switchLayoutMode) --
// тому підтверджується через ConfirmDialog ПЕРЕД збереженням. Без
// розкладених карток — застосовується одразу, без діалогу.
//
// Save-failure discrimination (мірорить src/app/main.tsx): onSave, що
// падає з AppError-подібною помилкою (є code/httpStatus — сервер
// відповів), показує Banner variant="error" з текстом помилки. onSave,
// що падає зі звичайною Error (fetch сам не спрацював — офлайн), означає,
// що запис прийнято локально і синхронізується пізніше — Banner
// variant="info".

import { useEffect, useState } from 'react';
import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/ui';
import type { LayoutMode } from '../domain/layout';

export interface DeclarationScreenState {
  declaration: string | null;
  layoutMode: LayoutMode;
  hasArrangedCards: boolean;
}

export interface DeclarationScreenProps {
  /** Завантажує поточну декларацію й режим розкладки. */
  loadStructure: () => Promise<DeclarationScreenState>;
  /** Зберігає нові значення. Кидає AppError-подібну помилку (code/httpStatus), якщо відповів сервер, або звичайну Error при мережевому збої (офлайн). */
  onSave: (input: { declaration: string; layoutMode: LayoutMode }) => Promise<void>;
}

interface LayoutModeOption {
  value: Exclude<LayoutMode, null>;
  label: string;
}

// Порядок -- саме той, що назвав Андрій (вимога 15): баланс навколо ядра /
// фокус і спостереження / причина і наслідок / вільна розкладка / готово до
// розкладання. "Фокус і спостереження" і "Причина і наслідок" -- ті самі
// формулювання, що вже існували як підвиди "за логікою" (D-83), лишені
// дослівно. "Вільна розкладка" -- перейменування підпису колишнього
// "Вільно" (той самий режим 'free'). "Готово до розкладання" -- новий
// режим 'staging'.
const LAYOUT_MODE_OPTIONS: LayoutModeOption[] = [
  { value: 'balance', label: 'Баланс навколо ядра' },
  { value: 'focus', label: 'Фокус і спостереження' },
  { value: 'cause_effect', label: 'Причина і наслідок' },
  { value: 'free', label: 'Вільна розкладка' },
  { value: 'staging', label: 'Готово до розкладання' },
];

interface AppErrorShape {
  message: string;
  code: unknown;
  httpStatus: unknown;
}

// Duck-typing замість `instanceof AppError` — тест (і реальний HTTP-шар
// портів) моделює "сервер відповів" будь-якою помилкою з полями
// code/httpStatus, не обов'язково класом shared/errors.
function isAppErrorShape(err: unknown): err is AppErrorShape {
  return typeof err === 'object' && err !== null && 'code' in err && 'httpStatus' in err;
}

export function DeclarationScreen({ loadStructure, onSave }: DeclarationScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [declaration, setDeclaration] = useState('');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(null);
  const [hasArrangedCards, setHasArrangedCards] = useState(false);
  const [savedLayoutMode, setSavedLayoutMode] = useState<LayoutMode>(null);
  const [banner, setBanner] = useState<{ variant: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  useEffect(() => {
    loadStructure().then((state) => {
      setDeclaration(state.declaration ?? '');
      setLayoutMode(state.layoutMode);
      setHasArrangedCards(state.hasArrangedCards);
      setSavedLayoutMode(state.layoutMode);
      setLoading(false);
    });
    // Навмисно без loadStructure у deps -- викликається рівно раз при монтуванні
    // (той самий підхід, що CardFace/CardBack: DI-функція стабільна для життя екрана).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  const persist = async (nextLayoutMode: LayoutMode): Promise<void> => {
    try {
      await onSave({ declaration, layoutMode: nextLayoutMode });
      setSavedLayoutMode(nextLayoutMode);
      setBanner({ variant: 'success', text: 'Збережено' });
    } catch (err: unknown) {
      if (isAppErrorShape(err)) {
        setBanner({ variant: 'error', text: err.message });
      } else {
        const message = err instanceof Error ? err.message : 'Не вдалося зберегти';
        setBanner({
          variant: 'info',
          text: `Немає з'єднання -- зміни збережено локально й будуть синхронізовані пізніше (офлайн). ${message}`,
        });
      }
    }
  };

  const handleSave = (): void => {
    const layoutChanged = layoutMode !== savedLayoutMode;
    const needsConfirm = hasArrangedCards && layoutChanged;

    if (needsConfirm) {
      setConfirmPending(true);
      return;
    }

    void persist(layoutMode);
  };

  const handleConfirmChange = (): void => {
    setConfirmPending(false);
    void persist(layoutMode);
  };

  const handleCancelChange = (): void => {
    setConfirmPending(false);
    setLayoutMode(savedLayoutMode);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Картина світу, навіщо, пріоритет
        <textarea
          value={declaration}
          onChange={(event) => setDeclaration(event.target.value)}
          rows={5}
          className="min-h-32 resize-y rounded-control border border-border bg-surface-solid px-3.5 py-2.5 font-sans text-sm font-normal text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
        />
      </label>

      {/* D-111: варіанти одного вибору (режим розкладки) лишаються поруч,
          як рядок пігулок, що переноситься на вузькому екрані. Вимоги
          14/15: ОДИН плоский список, без дворівневої структури. */}
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        {LAYOUT_MODE_OPTIONS.map((option) => {
          const isSelected = layoutMode === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-2 rounded-control border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isSelected
                  ? 'border-ink bg-ink/10 text-ink'
                  : 'border-border bg-surface-solid text-ink-muted hover:border-ink/40'
              }`}
            >
              <input
                type="radio"
                name="layoutMode"
                checked={isSelected}
                onChange={() => setLayoutMode(option.value)}
                className="h-4 w-4 accent-ink"
              />
              {option.label}
            </label>
          );
        })}
      </fieldset>

      <Button label="Зберегти" onClick={handleSave} />

      {banner !== null && <Banner variant={banner.variant} text={banner.text} />}

      {confirmPending && (
        <ConfirmDialog
          message="Зміна розкладки скине розташування вже розкладених карток. Продовжити?"
          confirmLabel="Змінити"
          cancelLabel="Скасувати"
          onConfirm={handleConfirmChange}
          onCancel={handleCancelChange}
        />
      )}
    </div>
  );
}
