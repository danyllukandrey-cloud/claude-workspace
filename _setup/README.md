# _setup — шаблони конфігурації для нового комп'ютера

Тут лежать файли, які **не потрапляють у git** (бо особисті або глобальні), але потрібні
на кожній машині. Коли розгортаєш проєкт на новому комп'ютері — виконай кроки нижче.

Навіщо: у `.gitignore` навмисно сховані `.claude/settings.local.json` (особисті overrides)
і `.env` (секрети). Тому після `git clone` їх треба створити заново з цих шаблонів.

## Що тут лежить

| Файл | Куди копіювати | Чому не в git |
|---|---|---|
| `settings.json` | `.claude/settings.json` | **насправді В git.** Копія на випадок, якщо треба відкотити |
| `settings.local.json.example` | `.claude/settings.local.json` | особисті overrides, у `.gitignore` |
| `user-settings.json` | `~/.claude/settings.json` | глобальний рівень, лежить поза репозиторієм |

## Розгортання на новому комп'ютері (Windows, PowerShell)

Виконуй із кореня репозиторію.

```powershell
# 1. Особисті налаштування проєкту (у git не йдуть)
Copy-Item _setup\settings.local.json.example .claude\settings.local.json

# 2. Глобальні налаштування (для всіх проєктів на цій машині)
#    УВАГА: спершу перевір, чи файл уже існує - не затирай наосліп!
Test-Path $HOME\.claude\settings.json
# якщо False:
New-Item -ItemType Directory -Force -Path $HOME\.claude | Out-Null
Copy-Item _setup\user-settings.json $HOME\.claude\settings.json

# 3. Секрети
Copy-Item .env.example .env
# далі відкрий .env і встав справжній ANTHROPIC_API_KEY

# 4. Перевірка, що все зійшлося
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\verify.ps1
```

Очікуваний результат кроку 4: `PASSED: 37 checks`.

## Якщо перевірка щось завалила

- **`User tier exists` — FAIL** → не виконано крок 2.
- **`all sandbox domains present in firewall` — FAIL** → додав домен у
  `.claude/settings.json`, але забув у `.devcontainer/init-firewall.sh`. Це два незалежні
  шари захисту, список доменів має збігатися в обох.
- **`firewall: LF line endings` — FAIL** → git перевів скрипт у CRLF. Перевір, що
  `.gitattributes` на місці, і переклонуй репозиторій.
- **`real .env is NOT tracked by git` — FAIL** → секрети потрапили в git. Терміново:
  `git rm --cached .env`, і **зміни ключі**, бо вони вже засвітилися в історії.
