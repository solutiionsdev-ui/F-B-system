# Cash Control: restaurant financial control (MVP core)

The daily financial control loop from the business plan: open the day,
enter POS totals, record expenses, count the drawer in USD and LBP, then close
and lock the day. It sits next to the restaurant's POS and does not replace it.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. No database install is needed: locally the app
runs PGlite (real Postgres compiled to WebAssembly) and stores data in
`.data/pglite`. On first start it creates the tables and loads demo data.

To start over with fresh demo data, stop the server and delete `.data/`.

### Demo logins

All demo users share the password `pilot-demo-2027`.

| Email | Role | Sees |
| --- | --- | --- |
| `owner@demo.test` | Owner, Demo Café Group | Everything, including the audit trail |
| `manager@demo.test` | Manager, Demo Café Group | Day-to-day operations; no audit trail |
| `accountant@demo.test` | Accountant for **both** groups | Read-only, corrections on closed days, "All clients" view |
| `bistro@demo.test` | Owner, Demo Bistro | Only the Bistro; can't see the Café Group |

The demo data has a week of closed days, one day flagged short by
1,790,000 LBP, an exchange-rate change partway through, and today's Hamra day
left open so you can count and close it.

## Tests

```bash
npm test
```

46 tests. The database tests run the real migrations and check the business
plan's guarantees against Postgres itself: one group can't see or write
another's data, accountants can't record expenses, closed days are locked,
rates and the audit log can't be rewritten, past days keep their exchange
rate, and a POS record can't be imported twice. The report tests check that
totals add up day by day and location by location, that each day is converted
at its own rate, and that CSV cells can't smuggle in spreadsheet formulas.

## Reports

Owners and accountants get a **Reports** page for any period (this month,
last month, last 7/30 days or custom dates), for all locations or one:

- Headline figures with a comparison to the previous period of the same length
- Sales by tender (cash, card, other) in USD, LBP and USD-equivalent
- Expenses by category and by where they were paid from
- Cash control: closed vs open days, shortages, overages, corrections, reasons
- A per-location split and a daily detail table linking to each day

Downloads:

- **PDF** management report (A4, ready to email to an accountant)
- **Daily CSV**: one row per day per location with every figure in both currencies
- **Expenses CSV**: every expense, including voided ones (marked), for the books

Net profit is deliberately withheld, as the business plan requires, until
unit costs are verified. "Collected minus expenses" is shown as a cash view
and labelled as not being profit.

## How it's built

| Piece | Where |
| --- | --- |
| USD/LBP maths (integer minor units, no floating point) | `src/lib/money.ts` |
| Expected vs counted cash | `src/lib/closing.ts` |
| Tables | `src/db/migrations/0001_init.ts` |
| Row-level security, locks, audit trigger | `src/db/migrations/0002_security.ts` |
| Business operations (framework-free) | `src/server/operations.ts` |
| Period reports, CSV and PDF | `src/server/reports.ts`, `report-csv.ts`, `report-pdf.ts` |
| Sessions and the current restaurant group | `src/server/auth.ts` |
| Screens | `src/app/(app)/` |

**Data isolation.** Every request runs in a transaction that switches to a
restricted `app_user` database role and sets the restaurant group and role.
Postgres row-level security then filters every table, so a missing `where`
clause in app code can't leak another group's data.

**Money.** Amounts are stored as bigint minor units (USD cents, whole LBP).
Rates are numeric(14,4) LBP per USD. Every business day stores the rate it
was opened with, and expenses store the rate in force when they were entered.

**Closing.** Closing writes a frozen snapshot (`day_closings`) and locks the
day. Triggers refuse any later change to its sales, expenses, cash movements
or counts. Corrections are posted as `adjustments` with a reason.

## Production

Set `DATABASE_URL` to a Postgres 15+ database (Supabase, Neon, RDS...) and
`SEED_DEMO=false`. Migrations run on start. If you use Supabase, connect
through the transaction pooler; the app turns off prepared statements for that.

## Not built yet (next steps toward the pilot)

- POS export import (needs real export files from the pilot restaurants)
- Team management screens (invite users, add locations)
- Petty cash fund balance tracking
- Hosted deployment
