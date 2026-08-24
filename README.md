# Bumpa Achievements Backend

Event-driven NestJS backend for an e-commerce achievements/badges system. Every purchase can unlock **achievements**; unlocking enough achievements earns a **badge**; every badge unlock automatically triggers a **₦300 cashback** transfer via Paystack.

## Table of contents

- [Architecture & design decisions](#architecture--design-decisions)
- [Domain model](#domain-model)
- [Event flow](#event-flow)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Prisma commands](#prisma-commands)
- [API reference](#api-reference)
- [Running tests](#running-tests)
- [Extending the system](#extending-the-system)
- [Project structure](#project-structure)

## Architecture & design decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | NestJS + TypeScript | Modern, structured Node backend with first-class DI, ideal for an event-driven domain like this one |
| Events | `@nestjs/event-emitter` | In-process pub/sub is enough at this scale, and keeps modules decoupled — `AchievementsService` has no idea `CashbackService` exists, they only communicate through events. Swapping this for a message broker later (Bull/RabbitMQ/SQS) would only mean changing the emit/listen calls, not the business logic |
| Database | PostgreSQL + Prisma | Type-safe queries, migrations, and a schema that reads as documentation |
| Payment provider | Paystack Transfer API | Widely used in Nigeria, well-documented sandbox mode, and the assessment's "local payment provider" fit. Isolated behind a `PaymentProvider` interface (`transfer(payload)`) so swapping providers later is a one-file change |
| Cashback destination | Bank account (not wallet) | The brief says "to the account of the user" |
| Cashback logging | Dedicated `CashbackTransaction` table | Every transfer attempt — success or failure — is recorded with the provider's reference/response, so payments are auditable and idempotency is enforceable at the data layer, not just in memory |
| Money values | Stored as integer kobo | Avoids floating-point rounding errors in currency math |

### Why the achievement rule engine is a loop, not a one-shot check

Achievements are split into two groups:
- **`purchases`** — thresholds based on how many purchases a user has made.
- **`achievements_count`** — thresholds based on how many achievements the user has *already unlocked*, across both groups.

That second group is self-referential: unlocking one of its own achievements changes the very count it's watching. So `AchievementsService.evaluateAndUnlock` (`src/achievements/achievements.service.ts`) handles the two groups differently — `purchases` only needs one pass (the purchase count is fixed for the call), while `achievements_count` re-checks itself in a loop until nothing new unlocks, correctly handling cascades (e.g. one purchase can unlock a purchase-count achievement *and* immediately cascade into an achievement-count achievement in the same request).

## Domain model

### Achievements (seed data, `prisma/seed.ts`)

Adding a new achievement is just a new seeded row — no code change required.

**Group: `purchases`**
| Name | Threshold |
|---|---|
| First Purchase | 1 |
| 5 Purchases | 5 |
| 10 Purchases | 10 |
| 25 Purchases | 25 |
| 50 Purchases | 50 |

**Group: `achievements_count`**
| Name | Threshold |
|---|---|
| 3 Achievements | 3 |
| 5 Achievements | 5 |
| 7 Achievements | 7 |

These 8 achievements are the entire catalog, so a user can reach at most 8 unlocked achievements total (traced end-to-end at purchase #10, #25, and #50 in the e2e suite).

### Badges (seed data)

Badge progression is based on **total unlocked achievements**, not purchases directly.

| Name | Required achievements |
|---|---|
| Beginner | 3 |
| Intermediate | 5 |
| Advanced | 8 |

Every tier is reachable purely from the 8 seeded achievements (Advanced is reached exactly when a user has unlocked all 8), so there's no dead, unreachable seed data.

## Event flow

```
POST /purchases
      │
      ▼
PurchaseMadeEvent
      │
      ▼
AchievementsService evaluates both groups (looping for cascades)
      │
      ├─► unlock achievement(s) ─► AchievementUnlockedEvent { achievement_name, user }
      │                                    │
      │                                    ▼
      │                          BadgesService checks total unlocked count
      │                                    │
      │                                    ├─► unlock badge(s) ─► BadgeUnlockedEvent { badge_name, user }
      │                                    │                              │
      │                                    │                              ▼
      │                                    │                     CashbackService
      │                                    │                       ├─ create CashbackTransaction (PENDING)
      │                                    │                       ├─ call PaymentProvider.transfer(...)
      │                                    │                       └─ update to SUCCESS/FAILED + log the response
      │                                    │
      │                                    └─► (no new badge) → stop
      │
      └─► (no new achievement) → stop
```

Every step is idempotent: achievement/badge unlocks rely on unique DB constraints (`skipDuplicates`), and `CashbackService` checks for an existing `PENDING`/`SUCCESS` transaction for the same `(userId, badgeId)` before ever calling the payment provider, so a badge is never paid out twice.

## Getting started

### With Docker (recommended — one command)

```bash
docker compose up --build
```

This starts Postgres, runs migrations, seeds the achievement/badge catalog, and boots the API on `http://localhost:3000`. A `PAYSTACK_SECRET_KEY` isn't required to run the app — without one, cashback transfers will fail cleanly and get logged as `FAILED` `CashbackTransaction` rows rather than crashing anything.

### Without Docker

Requires Node 24+ and a local/reachable Postgres instance.

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, etc.
npx prisma migrate dev
npm run db:seed
npm run start:dev
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string for the app |
| `DATABASE_URL_TEST` | Separate Postgres connection string used only by the e2e suite, so tests never touch dev data |
| `PORT` | HTTP port (defaults to 3000) |
| `PAYSTACK_SECRET_KEY` | Paystack secret key for the Transfer API. Leave empty to run everything except real cashback transfers (they'll fail and be logged, not crash) |

See `.env.example` for the full template.

## Prisma commands

```bash
npm run prisma:generate   # regenerate the Prisma Client
npm run prisma:migrate    # create + apply a new migration (dev)
npm run prisma:studio     # open Prisma Studio (visual DB browser)
npm run db:seed           # seed achievements + badges (idempotent, safe to re-run)
```

## API reference

All required endpoint:

### `GET /users/:userId/achievements`

```json
{
  "unlocked_achievements": ["First Purchase", "5 Purchases"],
  "next_available_achievements": ["10 Purchases", "5 Achievements"],
  "current_badge": "Beginner",
  "next_badge": "Intermediate",
  "remaining_to_unlock_next_badge": 3
}
```

- `next_available_achievements` returns only the **next** achievement per group (not every remaining one).
- `current_badge`/`next_badge` are `null` when the user hasn't unlocked any badge yet, or has already unlocked the highest one, respectively.

### Supporting endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/users` | Create a user (`email`, `name`, `accountNumber`, `bankCode`) |
| `GET` | `/users/:id` | Fetch a user |
| `POST` | `/purchases` | Record a purchase (`userId`, `amount` in kobo, optional `productId`) — triggers the whole unlock chain |
| `GET` | `/users/:userId/purchases` | List a user's purchases |
| `GET` | `/achievements` | List all achievement definitions |
| `GET` | `/badges` | List all badge definitions |
| `GET` | `/health` | Liveness/readiness check (confirms the DB is actually reachable) |

## Running tests

```bash
npm run test          # unit tests (fast, no DB — Prisma is mocked)
npm run test:e2e       # e2e tests (spins up against the dockerized postgres_test instance)
npm run test:cov       # unit test coverage
```

`npm run test:e2e` automatically migrates and seeds the test database first (via `pretest:e2e`) — just make sure `docker compose up -d postgres_test` is running.

Unit tests cover the rule-evaluation logic in isolation (achievement thresholds, cascades, badge tiers, cashback success/failure/idempotency) with an in-memory Prisma stand-in. E2e tests drive the real HTTP API against a real Postgres instance end-to-end: the full purchase → achievement → badge → cashback journey, response-shape checks at various states, validation errors, and payment-failure handling.

## Extending the system

- **Add an achievement**: insert a row in the `achievements` array in `prisma/seed.ts` (name, group, threshold, order) and reseed. No code changes.
- **Add a badge**: same, in the `badges` array — just make sure `requiredAchievements` is reachable given the current achievement catalog (see [Domain model](#domain-model)).
- **Add a new achievement group**: `AchievementsService` currently special-cases the `purchases` vs `achievements_count` groups by name (`unlockPurchaseAchievements` / `unlockAchievementCountAchievements`) since they use different underlying metrics (purchase count vs. total achievement count) — a third group would need its own metric source wired in similarly.
- **Swap the payment provider**: implement the `PaymentProvider` interface (`src/common/interfaces/payment-provider.interface.ts`) and rebind the `PAYMENT_PROVIDER` token in `src/cashback/cashback.module.ts`.
- **Move off in-process events**: `AppEvents` (`src/common/events/app-events.ts`) and the event classes are the only coupling point — swapping `@nestjs/event-emitter` for a broker means changing the emit/listen calls in the services/listeners, not the business logic itself.

## Project structure

```
src/
├── users/          # user CRUD
├── purchases/      # records purchases, emits PurchaseMadeEvent
├── achievements/   # rule evaluation, AchievementUnlockedEvent, the required endpoint
├── badges/         # badge threshold evaluation, BadgeUnlockedEvent
├── cashback/        # PaymentProvider interface + PaystackProvider, listens for BadgeUnlockedEvent
├── prisma/          # PrismaService/PrismaModule (global DB access)
├── common/
│   ├── events/       # event name constants + event payload classes
│   ├── interfaces/   # PaymentProvider interface + DI token
│   └── filters/      # global exception filter
└── main.ts

prisma/
├── schema.prisma
├── migrations/
└── seed.ts           # achievement/badge catalog (source of truth)

test/
└── achievements.e2e-spec.ts
```
