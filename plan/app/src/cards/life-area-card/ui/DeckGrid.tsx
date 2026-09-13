// DeckGrid (T25) -- сітка тайлів колоди карток.
//
// Навмисно узагальнений компонент (ISS-46): нічого не знає про статус картки
// (активна / архівна) -- лише рендерить items тайлами й повідомляє про клік
// через onOpen(id). Яку саме колекцію показати (активні картки, SCR-01, чи
// архівні, SCR-07) вирішує виклик пропами items/onOpen, а не сам DeckGrid --
// тому майбутня задача T36 (режим "архів") зможе імпортувати цей самий
// компонент без переписування, лише передавши інший items/onOpen.
//
// Правило залежностей (plan/app/CLAUDE.md): лише Tailwind-класи з токенів
// D-120 (docs/app/theme.css) -- жодного domain, жодного ports/app.
//
// D-120: тайл колоди -- не CTA (shared Button свідомо лишається одним-єдиним
// варіантом, Button.tsx §комент), а невелика матова rounded-card плитка з
// shadow-soft -- сфумато-підкладка (CardShell) тут навмисно не потрібна:
// важка для десятків плиток одночасно (нотатка кластеру "deck"). Тому тайл --
// власний <button>, той самий підхід, що вже в ConfirmDialog.tsx для кнопки
// "Скасувати" (Button не приймає className, і його єдиний стиль -- фірмовий
// bg-accent CTA -- не пасує вигляду тайла).

export interface DeckGridItem {
  /** Ідентифікатор картки -- прокидається в onOpen при кліку на тайл. */
  id: string;
  /** Назва картки -- підпис тайла. */
  name: string;
}

export interface DeckGridProps {
  /** Картки для показу тайлами. Порожній масив -- відповідальність виклику (EmptyState), не DeckGrid. */
  items: DeckGridItem[];
  /** Викликається з id картки, коли користувач відкриває тайл. */
  onOpen: (id: string) => void;
}

export function DeckGrid({ items, onOpen }: DeckGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className="rounded-card bg-surface-solid px-4 py-6 text-left font-display text-sm font-semibold text-ink shadow-soft transition-opacity hover:opacity-90"
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}
