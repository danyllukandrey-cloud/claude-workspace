// T10 -- редактор ОДНОГО пункту плану (spec.md AC-01, AC-02, AC-04).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що PlanScreen.tsx/
// DeclarationScreen.tsx): onCreate/onUpdate/onDelete/onClose -- ін'єктовані
// пропи-функції, жодного fetch() тут. HTTP-транспорт підключає композиційний
// корінь (src/app/main.tsx, T11).
//
// Один компонент на два входи, а не два схожі екрани: `target` каже, новий це
// пункт (прийшов із кнопки «+» горизонту) чи наявний (клік по тексту пункту).
// Поле й кнопка в обох випадках ті самі -- різниться лише те, ЩО робить
// збереження, і саме ця різниця тут і живе.
//
// Чому порожній текст перекладається в onDelete, а не в onUpdate: за
// контрактом (contracts/openapi.yaml) PATCH із порожнім `planText` -- це 422,
// прибирання пункту йде окремим DELETE. AC-04 описує жест у РЕДАКТОРІ
// («очистив текст і зберіг»), тож перекласти жест у виклик має саме ui --
// use-case оновлення навмисно лишається «оновлює або падає», без тихого
// видалення (див. коментар у app/update-plan-item.ts).
//
// AC-02 діє ТІЛЬКИ на створення: новому пункту без тексту нема чим бути, тож
// збереження блокується поясненням і жодного запиту не йде. На редагування
// це правило не поширюється -- інакше воно з'їло б сам жест AC-04.
//
// Лише пробіли трактуються як «порожньо» в обох гілках (той самий trim, що в
// домені): при створенні -- та сама помилка, що й на порожньому полі
// (AC-02 прямо: «no text or only spaces»), при редагуванні -- той самий жест
// прибирання. Відправити на сервер лише-пробільний текст не можна в жодному
// разі -- контракт відповів би 422, а користувач побачив би помилку там, де
// сам вважає, що очистив поле.

import { useState } from 'react';
import { Banner, Button, TextField } from '../../shared/ui';
import type { PlanHorizon } from '../domain/plan-item';
import type { PlanScreenItem } from './PlanScreen';
import { PLAN_HORIZON_LABELS } from './PlanScreen';

/** Що саме редагуємо: новий пункт у конкретному горизонті чи вже наявний пункт. */
export type PlanItemEditorTarget =
  | { kind: 'new'; horizon: PlanHorizon }
  | { kind: 'existing'; item: PlanScreenItem };

export interface PlanItemEditorProps {
  target: PlanItemEditorTarget;
  /** Створює новий пункт у своєму горизонті (AC-01). */
  onCreate: (input: { horizon: PlanHorizon; planText: string }) => Promise<void>;
  /** Зберігає новий непорожній текст наявного пункту. */
  onUpdate: (item: PlanScreenItem, planText: string) => Promise<void>;
  /** Прибирає пункт (м'яко) -- жест «очистив текст і зберіг», AC-04. */
  onDelete: (item: PlanScreenItem) => Promise<void>;
  /** Закриває редактор після успішного збереження. */
  onClose: () => void;
}

const TEXT_REQUIRED = 'Пункту плану потрібен текст, щоб існувати';

export function PlanItemEditor({
  target,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: PlanItemEditorProps): JSX.Element {
  const [planText, setPlanText] = useState(target.kind === 'existing' ? target.item.planText : '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const horizon = target.kind === 'new' ? target.horizon : target.item.horizon;

  const change = (value: string): void => {
    setPlanText(value);
    // Помилка стосується того, що вже виправляють -- тримати її під полем,
    // поки текст змінюється, означає сваритись на вже полагоджене.
    setValidationError(null);
  };

  // CH-02 (docs/features/life-plan-levels/changes.md, живе тестування
  // 2026-09-21): явна кнопка "Видалити" на наявному пункті -- та сама дія,
  // що вже стоїть за жестом "очистити текст і зберегти" (AC-04), лише
  // видима, без потреби здогадуватись про приховану поведінку.
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    if (target.kind !== 'existing') return;
    setSaveError(null);
    setDeleting(true);
    try {
      await onDelete(target.item);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Не вдалося видалити');
    } finally {
      setDeleting(false);
    }
  };

  const save = async (): Promise<void> => {
    const trimmed = planText.trim();
    setSaveError(null);

    // AC-04 буквально: "down to nothing, not just spaces" -- лише СПРАВДІ
    // порожній рядок (planText === '', жодного символу взагалі) рахується
    // жестом очищення. Лише-пробільний текст валідним новим текстом теж не
    // є -- показуємо те саме пояснення, що на створенні, а не мовчки
    // видаляємо пункт.
    if (trimmed === '' && planText !== '') {
      setValidationError(TEXT_REQUIRED);
      return;
    }

    if (target.kind === 'new' && trimmed === '') {
      setValidationError(TEXT_REQUIRED);
      return;
    }

    setSaving(true);
    try {
      if (target.kind === 'new') {
        await onCreate({ horizon: target.horizon, planText: trimmed });
      } else if (planText === '') {
        await onDelete(target.item);
      } else {
        await onUpdate(target.item, trimmed);
      }
      onClose();
    } catch (err: unknown) {
      // Лишаємось у редакторі: значення не збереглось, і текст користувача --
      // єдине його місце, губити його разом з екраном не можна.
      setSaveError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-6">
      <h2 className="text-sm font-bold text-ink">
        {PLAN_HORIZON_LABELS[horizon]}
      </h2>

      <TextField
        label="Текст пункту"
        value={planText}
        onChange={change}
        error={validationError ?? undefined}
        required={target.kind === 'new'}
      />

      {saveError !== null && <Banner variant="error" text={saveError} />}

      {/* CH-01/CH-02 (docs/features/life-plan-levels/changes.md, живе
          тестування 2026-09-21): "На зад" зліва -- закриває редактор БЕЗ
          збереження (і для нового, і для наявного пункту). "Видалити"
          праворуч -- лише для наявного пункту, нема чого видаляти в
          ненародженого. */}
      <div className="flex items-center gap-3 self-start">
        <Button label="На зад" onClick={onClose} disabled={saving || deleting} />
        <Button label="Зберегти" onClick={() => void save()} disabled={saving || deleting} />
        {target.kind === 'existing' && (
          <Button label="Видалити" onClick={() => void handleDelete()} disabled={saving || deleting} />
        )}
      </div>
    </div>
  );
}
