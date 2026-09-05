// Спільні UI-примітиви — цеглинки, з яких складаються всі картки.
//
// Навіщо: щоб кожна нова картка не винаходила ці елементи заново
// і щоб усі картки виглядали однаково.
//
// Правило залежностей (ADR-0004): це presentation-рівень. Імпортувати сюди
// domain будь-якої картки не можна — примітиви нічого не знають про предметну область.

export { CardShell } from './CardShell';
export type { CardShellProps } from './CardShell';

export { Spinner } from './Spinner';

export { Banner } from './Banner';
export type { BannerProps, BannerVariant } from './Banner';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

// Button, NumberField, TextField — ще заплановано, ще не написано (design-system.md).
