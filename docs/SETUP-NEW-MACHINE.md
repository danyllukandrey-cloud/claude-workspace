# Розгортання проєкту на новому комп'ютері

Покрокова інструкція: від чистої машини до робочого стану. Розрахована на Windows
і PowerShell. Виконуй по порядку, кожен крок перевіряй.

> **Що це, а що ні.** Це інструкція **вперед** — як налаштувати нову машину.
> `SETUP_DONE.md` у корені — це **журнал назад**, запис того, що ставилось на першій
> машині 2026-07. Не плутати: журнал не оновлюється, ця інструкція — оновлюється.

---

## Крок 1. Інструменти

Потрібні чотири. Перевір, що вже стоїть:

```powershell
git --version
node --version
claude --version
code --version
```

Що встановлювати, якщо команда не розпізнана:

| Інструмент | Навіщо | Звідки |
|---|---|---|
| **Git** | синхронізація між комп'ютерами | [git-scm.com/download/win](https://git-scm.com/download/win) |
| **Node.js 20+** | потрібен для Claude Code і для збірки застосунку | [nodejs.org](https://nodejs.org) — бери LTS |
| **VS Code** | редактор | [code.visualstudio.com](https://code.visualstudio.com) |
| **Claude Code** | сам агент | `npm install -g @anthropic-ai/claude-code` (після Node.js) |

Після встановлення **закрий і відкрий термінал** — інакше нові команди не побачаться.

Увійти в Claude Code:

```powershell
claude
```

Перший запуск попросить залогінитись через браузер.

---

## Крок 2. Забрати проєкт із GitHub

Обери місце (наприклад, Робочий стіл) і виконай:

```powershell
cd $HOME\Desktop
git clone https://github.com/danyllukandrey-cloud/claude-workspace.git
cd claude-workspace
```

З'явиться папка `claude-workspace` з усіма документами.

> **Шлях на кожній машині свій** (профілі Windows різні). Ніде не покладайся на
> абсолютні шляхи — тільки на відносні від кореня репозиторію.

---

## Крок 3. Особисті налаштування (не приходять із git)

Три файли навмисно **не потрапляють** у репозиторій: два особисті й один із секретами.
Їх треба створити з шаблонів, що лежать у `_setup/`.

```powershell
# 3.1 Особисті налаштування проєкту
Copy-Item _setup\settings.local.json.example .claude\settings.local.json

# 3.2 Глобальні налаштування (діють для всіх проєктів на цій машині)
#     СПЕРШУ перевір, чи файл уже є — не затирай наосліп!
Test-Path $HOME\.claude\settings.json
```

Якщо вивело `False` — файлу немає, копіюй:

```powershell
New-Item -ItemType Directory -Force -Path $HOME\.claude | Out-Null
Copy-Item _setup\user-settings.json $HOME\.claude\settings.json
```

Якщо вивело `True` — файл уже є з твоїми налаштуваннями. **Не перезаписуй.** Відкрий
обидва файли й перенеси правила з `_setup\user-settings.json` вручну.

```powershell
# 3.3 Секрети
Copy-Item .env.example .env
```

Далі відкрий `.env` у редакторі й встав справжній `ANTHROPIC_API_KEY`.

> **`.env` ніколи не потрапляє в git** — він у `.gitignore`. Якщо колись побачиш його
> у `git status` — стоп, щось зламано.

---

## Крок 4. Плагін SDD

Методологія проєкту працює на плагіні `sdd`. Запусти `claude` у папці проєкту й виконай
дві команди **всередині Claude Code**:

```
/plugin marketplace add genkovich/sdd
```

```
/reload-plugins
```

Перевірка: команда `/sdd:specify` має з'явитись у списку доступних.

---

## Крок 5. Перевірка, що все зійшлося

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\verify.ps1
```

Очікуваний результат: **`PASSED: 37 checks`**.

`Set-ExecutionPolicy` із `-Scope Process` діє тільки для цього вікна терміналу —
системні налаштування не змінюються.

### Якщо щось завалилось

| Помилка | Причина | Що робити |
|---|---|---|
| `User tier exists` — FAIL | не виконано крок 3.2 | скопіювати `user-settings.json` |
| `all sandbox domains present in firewall` — FAIL | домен додано в `.claude/settings.json`, але не в `.devcontainer/init-firewall.sh` | це два незалежні шари, список має збігатися в обох |
| `firewall: LF line endings` — FAIL | git перевів скрипт у CRLF | перевір, що `.gitattributes` на місці, і переклонуй репозиторій |
| `real .env is NOT tracked by git` — FAIL | секрети потрапили в git | `git rm --cached .env`, потім **змінити ключі** — вони вже в історії |
| `.claude\settings.local.json` — file missing | не виконано крок 3.1 | скопіювати з шаблону |

---

## Крок 6. Щоденний порядок роботи

Проєкт живе на двох комп'ютерах, тому порядок важливий:

```powershell
git pull     # ПЕРЕД роботою — забрати зміни з іншої машини
# ... працюєш ...
git add -A
git commit -m "опис того, що зробив"
git push     # ПІСЛЯ роботи — віддати зміни
```

**Забув `git pull` перед роботою** → при `push` отримаєш `rejected`. Не страшно:
виконай `git pull`, розберись із конфліктами (або попроси допомоги), потім `push`.

**Забув `git push` після роботи** → на другій машині твоїх змін не буде, і ви
розійдетесь у двох версіях. Це найнеприємніший сценарій, тому push — звичка.

> Проєкти Cowork між комп'ютерами **не синхронізуються** (обмеження платформи).
> На кожній машині створюється свій, наведений на локальну папку. Спільним є вміст
> папки, а не проєкт.

---

## Чого тут навмисно немає: Docker

`.devcontainer/` і `docker-compose.yml` лежать у репозиторії, але **Docker ставити не
треба**. Рівні захисту 1-3 (settings, permissions, sandbox) працюють без нього.

Рішення відкладене свідомо — див. [DECISIONS.md](./DECISIONS.md), запис **D-12**.
Там же тригер повернення і перший крок, коли до цього дійде.

---

## Куди дивитись далі

| Файл | Що там |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | правила роботи, правило єдиного джерела |
| [`docs/DECISIONS.md`](./DECISIONS.md) | реєстр рішень: що діє, що відкладено |
| [`docs/PROJECT-STATE.md`](./PROJECT-STATE.md) | повний стан проєкту |
| [`_setup/README.md`](../_setup/README.md) | що лежить у папці шаблонів |
