# Competitive research — картка ребалансування портфелю

**Дата:** 2026-07-22 · **Власник:** Andrii · **Стосується:** `idea-brief.md` §6

---

## Метод і межі точності (читати першим)

**Джерело:** WebSearch, 2026-07-22. Запити наведені в кінці кожної категорії.

**Умови власника:** нічого не вигадувати; неточну інформацію не враховувати; при сумніві — перепитати.

**Що це означає для цього файлу:**

1. **Списки коротші за 20 там, де пошук не підтвердив 20 назв.** Списки не добивались правдоподібними іменами. Реальна кількість підтверджених вказана в заголовку кожної категорії.
2. **Колонки функцій заповнені лише там, де є пряме підтвердження джерелом.** Де підтвердження немає — стоїть `не підтверджено`. Це НЕ означає «функції немає»; це означає «не перевірено».
3. **Назви, згадані в запиті, але не підтверджені результатами, виключені.** Зокрема: Gate.io, Bitget (деталей не знайдено), Swissquote, IG, Tiger Brokers, Futu (не підтверджені в результатах), Elite Trader, Trade2Win (не підтверджені).
4. **TradingView** названий у запиті власника, але його функції портфеля/ребалансу прямо не підтверджені — позначено відповідно.

**Висновок про повноту:** це надійна карта ландшафту, а не вичерпний реєстр 100 платформ. Рішення власника від 2026-07-22: другий прохід не потрібен, наявної глибини достатньо для висновку.

---

## Категорія 1 — Брокери ринку США (17 підтверджених)

| # | Платформа | Облік/трекінг портфеля | Ребалансування | Рівень ШІ |
|---|---|---|---|---|
| 1 | Charles Schwab | так | **так** — Intelligent Portfolios: авто-моніторинг, drift-смуги (bands) навколо кожного класу активів, tax-loss harvesting у таксованих рахунках | не підтверджено |
| 2 | Fidelity | так | **так** — Fidelity Go (робо-платформа) дає автоматичний ребаланс | не підтверджено |
| 3 | Interactive Brokers | так | не підтверджено | **високий** — Ask IBKR: natural-language портфельний асистент; AI News Summaries; Investment Themes (мапить тренди на акції). Безкоштовно всім клієнтам |
| 4 | Robinhood | так | не підтверджено | **високий** — Cortex (для Gold): виконує угоди з текстового промпту, персональна аналітика й portfolio insights, кастомні індикатори природною мовою |
| 5 | Vanguard | так | **так** — all-in-one фонди ребалансуються автоматично; окремо радники (від $50k, до 0.30%/рік) | не підтверджено |
| 6 | M1 Finance | так | **так** — «Pies» як візуальні цілі, авто-спрямування поповнень у недоважені позиції, one-click rebalance за розкладом | не підтверджено |
| 7 | E*TRADE | так | не підтверджено | не підтверджено |
| 8 | Webull | не підтверджено | не підтверджено | не підтверджено |
| 9 | Merrill Edge | не підтверджено | не підтверджено | не підтверджено |
| 10 | J.P. Morgan Self-Directed | не підтверджено | не підтверджено | не підтверджено |
| 11 | SoFi Invest | не підтверджено | не підтверджено | не підтверджено |
| 12 | Ally Invest | не підтверджено | не підтверджено | не підтверджено |
| 13 | tastytrade | не підтверджено | не підтверджено | не підтверджено |
| 14 | Firstrade | не підтверджено | не підтверджено | не підтверджено |
| 15 | TradeStation | не підтверджено | не підтверджено | не підтверджено |
| 16 | Public.com | не підтверджено | не підтверджено | **є** — згадується серед платформ, що перетворюють AI-агентів на брокерський інтерфейс |
| 17 | moomoo | не підтверджено | не підтверджено | не підтверджено |

**Важлива деталь:** Passiv (сторонній ребалансувальник) **не працює** з Fidelity, Schwab і Vanguard — американські інвестори цих брокерів відрізані від нього. Portfolio Genius обходить це через CSV-імпорт.

*Запити: «best US stock brokers 2026…», «brokerage portfolio rebalancing tool feature Fidelity Schwab Vanguard E*TRADE built-in», «AI features brokerage platforms 2026…»*

---

## Категорія 2 — Крипта: біржі та ребаланс-боти (9 бірж + 6 інструментів)

### Біржі

| # | Біржа | Ребалансування | Рівень ШІ |
|---|---|---|---|
| 1 | Binance | **так** — власний Rebalancing Bot, класичний fixed-allocation ребаланс | не підтверджено |
| 2 | Pionex | **так** — Rebalancing Bot із dual-coin і multi-coin режимами | не підтверджено |
| 3 | Coinbase | через сторонні боти (API) | не підтверджено |
| 4 | Kraken | через сторонні боти (API) | не підтверджено |
| 5 | OKX | не підтверджено | не підтверджено |
| 6 | Bybit | не підтверджено | не підтверджено |
| 7 | KuCoin | не підтверджено | не підтверджено |
| 8 | MEXC | не підтверджено | не підтверджено |
| 9 | BitMart | не підтверджено | не підтверджено |

### Інструменти ребалансування (найрелевантніші для нашої ідеї)

| # | Інструмент | Що робить | ШІ |
|---|---|---|---|
| 1 | **Coinrule** | AI Portfolio Manager: автоматизує ребаланс, **правила ризику** й входи по Binance, Coinbase, Kraken | **так, явно** |
| 2 | **3Commas** | Підключення бірж, **кастомні стратегії ребалансу** | не підтверджено |
| 3 | **Cryptohopper** | Portfolio Bot: автоматичний ребаланс, налаштовувані інтервали | не підтверджено |
| 4 | Holderlab | Ребаланс, бектестинг, аналітика | не підтверджено |
| 5 | Gainium | Ребаланс-боти | не підтверджено |
| 6 | DeFi smart contracts | Ребаланс на смартконтрактах | н/д |

### ⚠ Ключове відкриття категорії

Підтверджено три типи автоматичного ребалансування: **rule-based платформи**, API-боти й DeFi-контракти. Rule-based платформи дозволяють користувачу **створювати власні правила** за: відсотком відхилення, часовими інтервалами, ціновими порогами — і застосовувати їх через API до Binance/Kraken/Coinbase. Частина ботів використовує ML-моделі для прогнозу поведінки активів.

**Це прямо перетинається з ідеєю «імперативних правил користувача».** У крипті ця концепція вже реалізована й комодитизована.

*Запити: «top crypto exchanges 2026…», «crypto exchange portfolio rebalancing feature auto-rebalance bot Binance Coinbase Kraken AI»*

---

## Категорія 3 — Світові брокери (7 підтверджених)

| # | Брокер | Ринки / особливість | Ребалансування | ШІ |
|---|---|---|---|---|
| 1 | Interactive Brokers | Найкращий у Європі; глобальний доступ US/EU/UK/Asia, ф'ючерси, опціони, десятки бірж | не підтверджено | **високий** (див. кат. 1) |
| 2 | MEXEM | Топ-3 для європейців | не підтверджено | не підтверджено |
| 3 | Trading 212 | Реальні акції/ETF без комісії, швидке відкриття | не підтверджено | не підтверджено |
| 4 | XTB | CFD на акції/ETF/forex/сировину/індекси | не підтверджено | не підтверджено |
| 5 | eToro | Низькі комісії на акції/ETF, соціальний трейдинг | не підтверджено | **є** — серед платформ, що будують AI-агентів як інтерфейс |
| 6 | Saxo | Широкий портфель продуктів, сильний research | не підтверджено | не підтверджено |
| 7 | DEGIRO | Присутній у європейських рейтингах | не підтверджено | не підтверджено |

**Примітка:** IBKR протестований як №1 для європейців із понад 100 брокерів. Свідчень про вбудований ребаланс-рушій у нього не знайдено — сильний бік у доступі до ринків і ШІ-асистенті, не в ребалансі.

*Запит: «best international brokers 2026 Europe Asia Saxo DEGIRO eToro Trading212 XTB…»*

---

## Категорія 4 — Сервіси-трекери й аналітика (12 підтверджених)

| # | Сервіс | Облік портфеля | Ребалансування | Рівень ШІ |
|---|---|---|---|---|
| 1 | **Kubera** | так — складні портфелі, підключення до блокчейнів, бірж, Carta, фізичних активів | не підтверджено | **⚠ дає доступ ШІ: віддає портфель у ChatGPT, Claude або Perplexity** |
| 2 | **Portfolio Genius** | так — моніторинг drift у реальному часі по всіх рахунках, CSV-імпорт (Fidelity, Schwab, Vanguard) | **так** — AI-пропозиції угод (прийняти/ігнорувати), алерти по ребалансу, look-through аналіз прихованих перетинів | **високий** |
| 3 | **Snowball Analytics** | так — 1000+ брокерів світу, розподіл активів, продуктивність | **так** — вбудований rebalancing tool, бенчмаркінг | не підтверджено |
| 4 | **Sharesight** | так — з 2008, 500k+ інвесторів, 150+ країн, мультивалютність, податкова звітність | не підтверджено | не підтверджено |
| 5 | Empower | так | не підтверджено | не підтверджено |
| 6 | Morningstar Investor | так — найглибший research фондів, рейтинги, аналітика | не підтверджено | не підтверджено |
| 7 | Capitally | так | не підтверджено | не підтверджено |
| 8 | StockUnlock | так | не підтверджено | не підтверджено |
| 9 | Quicken | так — облік особистих фінансів + інвестиції | не підтверджено | не підтверджено |
| 10 | Passiv | так | **так** — рахує точні угоди під цільові частки; платно ставить ордери в один клік | не підтверджено |
| 11 | Portfolio Visualizer | бектестинг, Monte Carlo, тактичний розподіл активів, оптимізація | аналітичний, не виконавчий | не підтверджено |
| 12 | TradingView | **не підтверджено** (названий власником, функції портфеля/ребалансу в результатах не підтверджені) | не підтверджено | не підтверджено |

### ⚠ Друге ключове відкриття

**Kubera вже інтегрує Claude.** Зв'язка «мій портфель → ШІ-агент (у т.ч. Claude) → аналіз» існує на ринку сьогодні. **Portfolio Genius** іде далі: ШІ сам пропонує конкретні угоди, які користувач приймає або ігнорує.

*Запит: «TradingView Sharesight Kubera Snowball Analytics Empower Morningstar portfolio tracker rebalancing AI 2026»*

---

## Категорія 5 — Біржові форуми (12 підтверджених)

| # | Форум | Функції портфеля | Ребалансування | ШІ |
|---|---|---|---|---|
| 1 | **Bogleheads** | **так, але спільнотні** — Portfolio Tracker (Google-таблиця від TrackerDan), PIRS (Personal Investment Returns Spreadsheet від scoothome), Simba's backtesting spreadsheet, Portfolio Visualizer (від pvguy) | вручну через таблиці | ні |
| 2 | **StockTwits** | так — Portfolio Stream (фільтр повідомлень за своїми тікерами), підключення брокерського рахунку до вотчлиста | ні | не підтверджено |
| 3 | Reddit r/investing | ні — дискусії | ні | ні |
| 4 | Reddit r/stocks | ні | ні | ні |
| 5 | Reddit r/personalfinance | ні | ні | ні |
| 6 | Reddit r/wallstreetbets | ні | ні | ні |
| 7 | Reddit r/pennystocks | ні | ні | ні |
| 8 | Morningstar Investing Forum | ні | ні | ні |
| 9 | Motley Fool Investing Strategies | ні | ні | ні |
| 10 | ValuePickr | ні | ні | ні |
| 11 | Traderji | ні | ні | ні |
| 12 | Stockaholics | ні | ні | ні |

### ⚠ Третє ключове відкриття

Форуми — це місце, де **обговорюють правила й стратегії**, але не місце, де їх **застосовують до свого портфеля**. Показово, що найзріліша спільнота (Bogleheads) вирішує задачу обліку **саморобними Google-таблицями**, а більшість учасників або взагалі не веде облік, або веде власні таблиці.

Тобто розрив «правила обговорено → правила застосовано до мого портфеля» реальний і досі закривається вручну.

*Запити: «best investing trading forums 2026…», «Bogleheads forum portfolio tracking spreadsheet tools StockTwits portfolio feature»*

---

## Аналіз рівня залученості ШІ

**Три рівні, які видно в даних:**

**Рівень 1 — ШІ як асистент довкола платформи.** IBKR Ask IBKR (natural-language питання про портфель), AI News Summaries, Investment Themes. ШІ пояснює й шукає, але не керує портфелем.

**Рівень 2 — ШІ як генератор дій.** Robinhood Cortex виконує угоди з текстового промпту й будує кастомні індикатори природною мовою. Portfolio Genius пропонує конкретні угоди для ребалансу. Coinrule — AI Portfolio Manager із правилами ризику. Тут ШІ вже породжує дію, а людина підтверджує.

**Рівень 3 — ШІ як зовнішній мозок над даними.** Kubera віддає портфель у ChatGPT/Claude/Perplexity. Це найближче до ідеї картки — але аналіз відбувається **поза** системою, без збереження правил і без структури.

**Чого в даних НЕ видно:** ШІ, обмеженого **непорушними імперативними правилами користувача**, з fallback на правила системи. Скрізь ШІ або радить вільно (рівні 1-3), або виконує жорсткий алгоритм без ШІ (Binance Rebalancing Bot, M1 Pies). Зв'язки «жорсткі правила як рамка + агент усередині рамки» в підтверджених результатах немає.

---

## Відношення до ідеї ПЛАН і картки ребалансування

### Що з ідеї вже зайнято ринком (чесно)

| Елемент ідеї | Стан на ринку | Хто |
|---|---|---|
| Розрахунок докупівель під цільові частки | **Комодитизовано** | Passiv, M1, Portfolio Genius, безкоштовні калькулятори |
| Правила користувача (% відхилення, пороги, інтервали) | **Реалізовано** | 3Commas, Coinrule, Cryptohopper (крипта) |
| Дашборд-аналіз портфеля | **Комодитизовано** | Snowball, Kubera, Sharesight, Empower |
| Портфель + Claude/ШІ-аналіз | **Уже існує** | Kubera (експорт у Claude), Portfolio Genius |
| Авто-ребаланс за розкладом | **Комодитизовано** | Schwab, M1, Vanguard, Binance, Pionex |

### Що лишається реально вільним

1. **Агент, жорстко обмежений імперативними правилами користувача, з fallback на правила проєкту.** Ринок дає або вільний ШІ, або жорсткий алгоритм. Проміжної моделі в підтверджених даних немає.
2. **Портфель як структурна одиниця плану життя.** Усі знайдені рішення — самодостатні інструменти про гроші. Жодне не є карткою всередині ширшої ієрархії, де метрики портфеля успадковують логіку структури вищого рангу. Це прямо відповідає §2.1 (відірваність).
3. **Єдина рамка правил через різні класи активів.** Крипто-боти живуть у крипті, брокерські ребалансери — у цінних паперах. Спільної рамки правил над обома не підтверджено.
4. **Правила як збережений артефакт.** У Kubera аналіз ШІ разовий і зовнішній; правила не зберігаються як частина системи. Картка тримає правила як постійний об'єкт, за яким робиться і розрахунок, і аналіз на звороті.

### Що це означає для брифу

**Диференціація зміщується.** Початкове формулювання «жоден не поєднує правила + агента + структуру» спростовано: правила + агент **уже поєднані** (Coinrule, Portfolio Genius). Справжній незайнятий простір — **структура вищого рангу** (пункт 2) плюс **імперативність правил як рамка для агента** (пункт 1).

**Ризик, який це підсвічує.** Якщо картку розглядати як окремий інструмент ребалансу, вона програє Passiv/M1/Snowball за функціями й зрілістю. Її сенс тримається виключно на вбудованості в ПЛАН. Це підсилює §10 і робить §3 (вбудованість) не «приємним бонусом», а єдиною підставою існування.

**Питання, винесене в §15 Open questions:** чи є ПЛАН достатньою причиною, щоб інвестор відмовився від зрілого спеціалізованого трекера на користь картки?

---

## Джерела

- [8 Best Portfolio Rebalancing Tools 2026 — Portfolio Genius](https://portfoliogenius.ai/blog/automated-portfolio-rebalancing-tools)
- [Track Your Portfolio From Any Broker (2026) — Portfolio Genius](https://portfoliogenius.ai/blog/broker-integrations)
- [15 Best Portfolio Tracker Apps 2026 — Portfolio Genius](https://portfoliogenius.ai/blog/best-portfolio-trackers-2026)
- [Best Brokerage Accounts of 2026 — NerdWallet](https://www.nerdwallet.com/investing/best/online-brokers-for-stock-trading)
- [The Best Brokers for AI Trading — NerdWallet](https://www.nerdwallet.com/investing/best/brokers-ai-trading)
- [7 Best Stock Brokers for 2026 — StockBrokers.com](https://www.stockbrokers.com/guides/online-stock-brokers)
- [Best Stock Brokers in the US for 2026 — BrokerChooser](https://brokerchooser.com/best-brokers/best-stock-brokers-in-the-us)
- [Best Stock Brokers for Europeans in 2026 — BrokerChooser](https://brokerchooser.com/best-brokers/best-stock-brokers-for-europeans)
- [Best Brokers for AI Investments in 2026 — BrokerChooser](https://brokerchooser.com/best-brokers/best-brokers-for-ai-investments)
- [IBKR, eToro, Robinhood, Public.com Turning AI Agents Into The Next Brokerage Interface — FinanceFeeds](https://financefeeds.com/interactive-brokers-etoro-robinhood-public-com-and-thinkmarkets-are-turning-ai-agents-into-the-next-brokerage-interface/)
- [Best Crypto Exchanges in 2026 — Kraken Learn](https://www.kraken.com/learn/best-crypto-exchanges)
- [10 Best Crypto Exchanges and Apps of 2026 — Forbes Advisor](https://www.forbes.com/advisor/investing/cryptocurrency/best-crypto-exchanges/)
- [Best Crypto Portfolio Rebalancing Bots — Gainium](https://gainium.io/blog/best-crypto-portfolio-rebalancing-bots)
- [AI Portfolio Manager — Coinrule](https://coinrule.com/ai-portfolio-manager/)
- [Crypto Portfolio Bot — Cryptohopper](https://www.cryptohopper.com/features/portfolio-bot)
- [Top Crypto Portfolio Rebalancing Tools For 2026 — CoinSutra](https://coinsutra.com/crypto-portfolio-rebalancing-tools/)
- [Best Portfolio Tracker 2026: Capitally vs Kubera, Sharesight & Snowball — Capitally](https://www.mycapitally.com/blog/best-portfolio-tracker-for-the-modern-diy-investor)
- [6 Best Snowball Analytics Alternatives — StockUnlock](https://stockunlock.com/snowball-analytics-alternatives.html)
- [8 Best Investment Tracking Apps 2026 — Rob Berger](https://robberger.com/investment-tracking-apps/)
- [Tools and calculators — Bogleheads](https://www.bogleheads.org/w/index.php?title=Tools_and_calculators)
- [Using a spreadsheet to maintain a portfolio — Bogleheads](https://www.bogleheads.org/wiki/Using_a_spreadsheet_to_maintain_a_portfolio)
- [Top 25 Investment Forums in 2026 — Feedspot](https://forums.feedspot.com/investment_forums/)
- [How to Use StockTwits: The Portfolio Stream — Stocktwits Blog](https://blog.stocktwits.com/how-to-use-stocktwits-the-portfolio-stream-61b7c532253b)
- [Schwab Rebalancing tool — Bogleheads.org](https://www.bogleheads.org/forum/viewtopic.php?t=356796)
- [M1 portfolio automation — M1](https://m1.com/blog/be-your-own-investment-manager-with-portfolio-automation/)
