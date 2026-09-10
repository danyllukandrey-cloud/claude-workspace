// Вигляд картки "Навчання" (generic life-area-card, D-23).
//
// Правило залежностей (ADR-0004): ui має право імпортувати domain цієї ж картки
// і спільні примітиви з shared/ui. У зворотний бік — ні: domain про ui не знає.

export { CreateCardForm } from './CreateCardForm';
export type { CreateCardFormInput, CreateCardFormProps } from './CreateCardForm';
