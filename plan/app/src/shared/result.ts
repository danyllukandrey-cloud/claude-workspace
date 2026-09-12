// Спільний sentinel-тип "очікуваного результату" для доменного шару backend-фіч
// (docs/features/agent/adr/0006-domain-sentinel-for-expected-errors.md, Accepted):
// domain-функції НІКОЛИ не кидають виняток для очікуваного результату (правило
// порушено, вкладення нерозпізнане, стан не дозволяє перехід) -- лише
// повертають типізований Result<T, E>, викликач (`app/`) явно розбирає `ok`.
//
// "Одна конвенція на весь бекенд" (ADR-0006 §Positive) -- тому файл живе тут,
// у shared/, а не всередині однієї фічі: перший файл (`agent/domain/proposal.ts`,
// T8) визначив цей самий тип локально "щоб лишитись у межах files_hint задачі";
// винесено сюди тим самим проходом, що вирівняв T9/T10/T34/T36 під те саме ADR,
// щоб domain-файли кожної наступної backend-фічі імпортували один спільний тип,
// а не копіювали Ok/Err заново.
//
// Аварійні (непередбачені) збої -- ADR-0006 §Neutral -- і далі йдуть звичайним
// винятком до глобального error-handler на межі HTTP; цей тип стосується лише
// очікуваних доменних результатів.

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
