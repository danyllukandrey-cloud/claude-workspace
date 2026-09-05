# Живе дерево міграцій -- мапа "живий файл <- застейджений файл"

> Наскрізна нумерація через усі фічі (ADR-0006). Застейджений файл ПІСЛЯ promote
> не редагуємо -- нова правка йде наступною міграцією (staged-копія лишається
> зафіксованим design-record, git її пам'ятає).

| Живий файл | Застейджений файл |
|---|---|
| `1788612954750_create-app-user.sql` | `agent/migrations/01_create_app_user.{up,down}.sql` |
| `1788612954769_create-card.sql` | `life-area-card/migrations/01_create_card.{up,down}.sql` |
