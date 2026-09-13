// Поле вводу чату SCR-01 (T25) -- текст і/або вкладення (фото/документ),
// AC-01 (текст), AC-10/AC-19 (вкладення замінює текстовий опис повністю).
// `MessageCreate` у contracts/openapi.yaml дозволяє content=NULL коли є
// attachment, і навпаки -- та сама форма тут: обидва поля незалежно
// опційні, надіслати можна лише коли хоч одне не порожнє.
//
// Controlled, але зі внутрішнім чернетковим станом (текст/файл) -- той самий
// підхід, що TextField (значення контролює компонент, поки не надіслано);
// після onSend компонент сам скидає чернетку, викликач не повинен
// синхронізувати controlled value ззовні для цього.
//
// Composer СКЛАДАЄТЬСЯ зі спільних примітивів shared/ui (Review 2026-09,
// finding 3): текстове поле -- TextField, кнопка відправки -- Button.
// Єдиний бере bare <input type="file"> -- для вкладення в repo ще нема
// спільного примітиву. Наслідок: TextField (shared/ui/TextField.tsx) не
// приймає prop `disabled` (жоден інший виклик у репозиторії його теж не
// передає) -- тому поки повідомлення "в польоті" (`disabled` тут), сам
// текстовий інпут лишається технічно клікабельним; заблоковані лише
// вкладення-інпут і кнопка "Надіслати" (canSend-ґейт і так не дає
// відправити текст без натискання кнопки). Розширювати TextField
// власним disabled-пропом -- поза межами цього фікса (торкнув би спільний
// примітив і всі його виклики).
//
// Правило залежностей (plan/app/CLAUDE.md): чистий presentation-примітив,
// нічого з domain/ports -- байти вкладення транзитні (openapi.yaml
// MessageCreate.attachment: "не зберігаються"), сам fetch робить викликач.

import { useState } from 'react';
import { Button, TextField } from '../../../shared/ui';

export interface ComposerSendInput {
  /** NULL, якщо надіслано лише вкладення без тексту (AC-10). */
  content: string | null;
  /** NULL, якщо надіслано лише текст без вкладення (AC-01). */
  attachment: File | null;
}

export interface ComposerProps {
  /** Викликається з чернеткою при надсиланні; сам HTTP-запит (POST /messages) робить викликач. */
  onSend: (input: ComposerSendInput) => void;
  /** Композер недоступний, поки попереднє повідомлення в польоті. */
  disabled?: boolean;
}

export function Composer({ onSend, disabled = false }: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const trimmed = text.trim();
  const canSend = trimmed !== '' || attachment !== null;

  const handleSend = (): void => {
    if (!canSend) return;
    onSend({
      content: trimmed === '' ? null : text,
      attachment,
    });
    setText('');
    setAttachment(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-solid p-3 shadow-soft">
      <TextField label="Повідомлення" value={text} onChange={setText} placeholder="напиши або додай фото" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-muted">
          Прикріпити фото
          <input
            type="file"
            disabled={disabled}
            onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
            className="max-w-[9.5rem] text-xs text-ink-muted file:mr-1.5 file:rounded-control file:border-0 file:bg-accent-soft file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-accent"
          />
        </label>
        <Button label="Надіслати" onClick={handleSend} disabled={disabled || !canSend} />
      </div>
    </div>
  );
}
