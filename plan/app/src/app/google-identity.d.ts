// Мінімальна ambient-декларація Google Identity Services (GIS) -- бібліотека
// вантажиться зовнішнім <script> (ADR-0006 "### Фронтенд (ISS-52)"), не npm-
// пакетом, тому типів немає. Тут лише те, чим реально користується main.tsx:
// initialize (client_id + колбек) і renderButton (кнопка в контейнер).

interface GoogleIdentityCredentialResponse {
  credential: string;
}

interface GoogleIdentityAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleIdentityCredentialResponse) => void;
  }): void;
  renderButton(container: HTMLElement, options: Record<string, unknown>): void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleIdentityAccountsId;
    };
  };
}
