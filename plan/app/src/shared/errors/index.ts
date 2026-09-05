// Спільна помилка use-case шару (app/) для всіх карток -- ADR-0006 §Обґрунтування
// ("app-шар кидає той самий AppError('card.not_found', 404)").
//
// Той самий формат, що й доменні помилки (CardValidationError, ProgressValidationError):
// код + повідомлення, жодних побічних ефектів. httpStatus -- окреме поле, не позиційний
// аргумент, бо на момент написання use-case шару (T13-T20/T33/T34) шар портів (T21+),
// що мапить код на HTTP-статус, ще не існує; тут лише готуємо форму, якою він скористається.
//
// code відповідає патерну з контракту (openapi.yaml, Error.code): ^[a-z_]+\.[a-z_]+$.

export class AppError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
