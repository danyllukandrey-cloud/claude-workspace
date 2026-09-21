# Живе дерево міграцій -- мапа "живий файл <- застейджений файл"

> Наскрізна нумерація через усі фічі (ADR-0006). Застейджений файл ПІСЛЯ promote
> не редагуємо -- нова правка йде наступною міграцією (staged-копія лишається
> зафіксованим design-record, git її пам'ятає). Хеш -- SHA-256 staged up+down
> вмісту В МОМЕНТ promote (computeContentHash) -- наступний запуск скрипта
> звіряє його з поточним staged-вмістом і гучно попереджає при розбіжності.
>
> Review 2026-09-07 (T51): колонку "Хеш" додано заднім числом для 11 рядків
> нижче, що вже існували до цього фіксу -- значення обчислені зі СТАНУ
> staged-файлів на момент додавання колонки (2026-09-07), не з моменту
> оригінального promote. Це встановлює базову лінію для виявлення дрейфу
> НАПЕРЕД; воно НЕ доводить заднім числом, що ці 11 файлів не редагувались
> між своїм promote і 2026-09-07 -- на це задокументованого способу
> перевірити вже нема (git-історія staged-файлів це може, але скрипт цього не робить).
>
> `05_add_card_status`/`06_add_card_restore` -- ВИНЯТОК серед тих 11: хеш тут
> відображає staged-вміст ПІСЛЯ навмисної правки down-міграції тим самим T51
> (data-loss guard, `DELETE ... WHERE transition NOT IN (...)` перед звуженням
> CHECK) -- застейджений .down.sql редагувався навмисно, синхронно з живим
> файлом, не є нововиявленим дрейфом.

| Живий файл | Застейджений файл | Хеш |
|---|---|---|
| `1788612954750_create-app-user.sql` | `agent/migrations/01_create_app_user.{up,down}.sql` | `c9e789fd4b24c8b8e9b4cd944192664af8695b44b87163f99eba2be07d2c5e5d` |
| `1788612954769_create-card.sql` | `life-area-card/migrations/01_create_card.{up,down}.sql` | `a6e93d26f78c13c785c4e39be43f0a0f19fac04511c634a9f67225ee94d668a8` |
| `1788614120296_create-metric-block.sql` | `life-area-card/migrations/02_create_metric_block.{up,down}.sql` | `2022ab8324c033c33c491d47b334bb91fc93e4234a79b33722fdb52a6eb3b77f` |
| `1788614120302_create-card-lifecycle-event.sql` | `life-area-card/migrations/04_create_card_lifecycle_event.{up,down}.sql` | `3e38bb57d179edbf59653ceb3c5a364fd256b21eec6a45c2e887555facfc1105` |
| `1788614120305_add-card-owner-fk.sql` | `life-area-card/migrations/07_add_owner_fk.{up,down}.sql` | `c6a67de509793dab4a415a1b77d70db9d1af09750ff6ed47ded8dac1fbb6a758` |
| `1788614654217_create-entry.sql` | `life-area-card/migrations/03_create_entry.{up,down}.sql` | `83d758af15bee2ab720d8ad8447076ce4420076aa7201572fbf760d9151b4bfb` |
| `1788614654221_add-card-status.sql` | `life-area-card/migrations/05_add_card_status.{up,down}.sql` | `e29eec1ce62359f6e769ed385253cc6520f70e7124dde04c74b2cc48fb0d12ed` |
| `1788615576576_add-card-restore.sql` | `life-area-card/migrations/06_add_card_restore.{up,down}.sql` | `a49767140f571dd59c4e42625fbd7746571665d87e72c5362828f65f48d2c371` |
| `1788631003265_create-structure.sql` | `structure/migrations/backend/01_create_structure.{up,down}.sql` | `b2dc8ca7a38479d2af142f056893669bd520508799c9d4dab0fa10a19938126a` |
| `1788631003271_create-structure-layout-position.sql` | `structure/migrations/backend/02_create_structure_layout_position.{up,down}.sql` | `372592312b66dc3c3ab765988d70e90af2c973fec28191ae9bddf8be8b050684` |
| `1788631003274_add-structure-owner-fk.sql` | `structure/migrations/backend/03_add_owner_fk.{up,down}.sql` | `ff2be111cf49cb80a39e9538856d4c4ec22708c9454580bfc4a9e8ca968163ee` |
| `1789122610006_add-logic-variant.sql` | `structure/migrations/backend/04_add_logic_variant.{up,down}.sql` | `57360a2e568cd37429a70e7842177d96d2a55cfe96439b391c5ed92b4ff02bb1` |
| `1789123033656_create-structure-history-event.sql` | `structure/migrations/backend/05_create_structure_history_event.{up,down}.sql` | `013f2e70eb3c5f6be0f29ee5725a601b16bf084f663bc44ea20dadfe9bd5eebf` |
| `1789151324598_make-cell-index-nullable.sql` | `structure/migrations/backend/06_make_cell_index_nullable.{up,down}.sql` | `25e7368bc101d760544ca73fbe5decd5b61879a0842ddbb526b6eed664a4ed33` |
| `1789458805273_add-metric-block-status.sql` | `life-area-card/migrations/08_add_metric_block_status.{up,down}.sql` | `5d6ffd6a2c53fda9c2d8cd3cfcb12af8f5619f48cc8fe55184ea0447a763996b` |
| `1789463867853_create-action-log.sql` | `agent/migrations/12_create_action_log.{up,down}.sql` | `3d505164fff585416f0f5ac8fce3482536e04c5f1bc1c0312de1830e5e810e70` |
| `1789464101168_flatten-layout-mode.sql` | `structure/migrations/backend/07_flatten_layout_mode.{up,down}.sql` | `428767dc4c0add1fc7ecaebf41f17c54d15b917fb764b9e7c4251dff12e2346b` |
| `1789479885291_add-position-xy.sql` | `structure/migrations/backend/08_add_position_xy.{up,down}.sql` | `686bdcca648c652fed0428c46eafa5b84dc79a836ecb5cfdeb8c3f657b36d8ba` |
| `1789479885297_create-structure-connection.sql` | `structure/migrations/backend/09_create_structure_connection.{up,down}.sql` | `431773757cc57b279916f80c3876c359f60210319299472104cc41f3634bc5ba` |
| `1789841424996_add-card-tracking-mode.sql` | `life-area-card/migrations/09_add_card_tracking_mode.{up,down}.sql` | `dee106861ff6ee0061eab9cd03b27f38958b9c408ea77fc510846afea078bc7d` |
| `1789912813806_create-plan-item.sql` | `life-plan-levels/migrations/01_create_plan_item.{up,down}.sql` | `f511aa875720bc53a5e3d2129fc7f35018ea6213155ff9196aa8809a8cc070cc` |
| `1789981137560_expand-card-tracking-mode.sql` | `life-area-card/migrations/10_expand_card_tracking_mode.{up,down}.sql` | `abb1f8b4fe4fba8c799afe06c47ab6f04441b3aeaeaffa828b44be81845c9cb0` |
