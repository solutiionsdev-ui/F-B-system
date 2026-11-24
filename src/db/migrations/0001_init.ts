// Core tables. Money is stored as integer minor units (USD cents, whole LBP)
// in bigint columns. Exchange rates are numeric(14,4) LBP per 1 USD.
// Composite (id, org_id) foreign keys make it impossible for a child row to
// point at another restaurant's parent row.
export const migration0001 = /* sql */ `
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'single' check (plan in ('single', 'multi', 'enterprise')),
  cost_data_verified boolean not null default false,
  variance_tolerance_cents bigint not null default 100 check (variance_tolerance_cents >= 0),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'accountant')),
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

create table sessions (
  id text primary key, -- sha256 of the cookie token; the raw token is never stored
  user_id uuid not null references users(id) on delete cascade,
  active_org_id uuid references organizations(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  timezone text not null default 'Asia/Beirut',
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  lbp_per_usd numeric(14, 4) not null check (lbp_per_usd > 0),
  effective_at timestamptz not null default now(),
  source text not null check (source in ('market', 'bank', 'custom')),
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create index exchange_rates_lookup on exchange_rates (org_id, effective_at desc);

create table business_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  rate_id uuid not null,
  opening_float_usd bigint not null default 0 check (opening_float_usd >= 0),
  opening_float_lbp bigint not null default 0 check (opening_float_lbp >= 0),
  opened_by uuid references users(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references users(id),
  closed_at timestamptz,
  unique (location_id, business_date),
  unique (id, org_id),
  foreign key (location_id, org_id) references locations(id, org_id),
  foreign key (rate_id, org_id) references exchange_rates(id, org_id),
  check ((status = 'closed') = (closed_at is not null))
);

-- Sales and payment totals for a day: typed in from the POS end-of-day
-- report (source 'manual') or imported from a POS export ('pos_import').
create table sales_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  business_day_id uuid not null,
  source text not null check (source in ('manual', 'pos_import')),
  external_ref text, -- the POS's own record id, used to refuse duplicate imports
  line_type text not null check (line_type in ('payment', 'refund', 'discount', 'void', 'tax', 'service_charge')),
  tender text check (tender in ('cash', 'card', 'other')),
  currency text not null check (currency in ('USD', 'LBP')),
  amount_minor bigint not null check (amount_minor >= 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_day_id, org_id) references business_days(id, org_id) on delete cascade,
  foreign key (location_id, org_id) references locations(id, org_id),
  check ((line_type in ('payment', 'refund')) = (tender is not null))
);
create unique index sales_lines_no_duplicates on sales_lines (location_id, source, external_ref) where external_ref is not null;
create index sales_lines_day on sales_lines (business_day_id);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  archived boolean not null default false,
  unique (org_id, name),
  unique (id, org_id)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  business_day_id uuid,
  expense_date date not null,
  category_id uuid not null,
  description text not null,
  vendor text,
  currency text not null check (currency in ('USD', 'LBP')),
  amount_minor bigint not null check (amount_minor > 0),
  paid_from text not null check (paid_from in ('drawer', 'petty_cash', 'bank', 'owner')),
  rate_id uuid not null,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid references users(id),
  voided_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_day_id, org_id) references business_days(id, org_id),
  foreign key (location_id, org_id) references locations(id, org_id),
  foreign key (category_id, org_id) references expense_categories(id, org_id),
  foreign key (rate_id, org_id) references exchange_rates(id, org_id),
  check (paid_from <> 'drawer' or business_day_id is not null),
  check ((status = 'voided') = (void_reason is not null and voided_at is not null))
);
create index expenses_day on expenses (business_day_id);

-- Cash put into or taken out of the drawer that is not a sale or expense:
-- safe drops, change top-ups, owner withdrawals.
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_day_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  currency text not null check (currency in ('USD', 'LBP')),
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_day_id, org_id) references business_days(id, org_id)
);

create table cash_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_day_id uuid not null,
  currency text not null check (currency in ('USD', 'LBP')),
  denominations jsonb not null default '{}'::jsonb,
  loose_minor bigint not null default 0 check (loose_minor >= 0),
  counted_minor bigint not null check (counted_minor >= 0),
  counted_by uuid references users(id),
  counted_at timestamptz not null default now(),
  unique (business_day_id, currency),
  foreign key (business_day_id, org_id) references business_days(id, org_id)
);

-- Frozen result of closing a day. Never recalculated, so past reports
-- stay exactly as they were signed off.
create table day_closings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_day_id uuid not null unique,
  rate_id uuid not null,
  expected_usd bigint not null,
  counted_usd bigint not null,
  variance_usd bigint not null,
  expected_lbp bigint not null,
  counted_lbp bigint not null,
  variance_lbp bigint not null,
  variance_equiv_cents bigint not null,
  within_tolerance boolean not null,
  variance_reason text check (variance_reason in ('counting_error', 'unrecorded_expense', 'change_shortage', 'rate_rounding', 'suspected_loss', 'other')),
  note text,
  closed_by uuid references users(id),
  closed_at timestamptz not null default now(),
  foreign key (business_day_id, org_id) references business_days(id, org_id),
  foreign key (rate_id, org_id) references exchange_rates(id, org_id),
  check (within_tolerance or variance_reason is not null)
);

-- Corrections to a closed day. Closed days are locked; mistakes found later
-- are recorded here with a reason instead of editing history.
create table adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_day_id uuid not null,
  currency text not null check (currency in ('USD', 'LBP')),
  amount_minor bigint not null check (amount_minor <> 0),
  reason text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_day_id, org_id) references business_days(id, org_id)
);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  user_id uuid,
  table_name text not null,
  op text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default clock_timestamp()
);
create index audit_log_org on audit_log (org_id, at desc);
`;
