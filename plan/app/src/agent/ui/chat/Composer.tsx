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
// Правило залежностей (plan/app/CLAUDE.md): чистий presentation-примітив,
// нічого з domain/ports -- байти вкладення транзитні (openapi.yaml
// MessageCreate.attachment: "не зберігаються"), сам fetch робить викликач.

import { useState } from 'react';

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
    <div>
      <label>
        Повідомлення
        <input
          type="text"
          value={text}
          placeholder="напиши або додай фото"
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label>
        Прикріпити фото
        <input
          type="file"
          disabled={disabled}
          onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
        />
      </label>
      <button type="button" onClick={handleSend} disabled={disabled || !canSend}>
        Надіслати
      </button>
    </div>
  );
}
