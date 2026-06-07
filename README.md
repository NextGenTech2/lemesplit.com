# SplitEasy - Smart & Collaborative Expense Splitter

SplitEasy is a premium, mobile-first single-page application designed for dividing restaurant bills and tracking travel group expenses. It features two modes:
1. 🍽️ **Quick Split**: An offline calculator to split restaurant or grocery bills across multiple items/categories with custom participant lists instantly.
2. 🏕️ **Trip / Outing**: A real-time database-backed group ledger that syncs expenses dynamically, computes optimized settlement transactions using a greedy algorithm, and provides a trust-based UPI confirmation receipt flow.

---

## Technical Architecture

* **Frontend**: Vanilla HTML5, CSS3, ES6+ JavaScript, and Tailwind CSS (via CDN).
* **Database & Sync**: Supabase (JS Client via CDN). Real-time subscriptions broadcast changes dynamically to all active group members.
* **Settlement Engine**: A greedy optimization algorithm designed to minimize the number of peer-to-peer debt payments.

---

## Supabase Database Setup

To enable **Trip Mode**, you must have a Supabase project with the following PostgreSQL tables. In your Supabase Dashboard, navigate to the **SQL Editor** and run the query below:

```sql
-- 1. Create Trips Table
create table trips (
  id text primary key,
  name text not null,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days'),
  host_name text not null
);

-- 2. Create Members Table
create table members (
  id uuid primary key default gen_random_uuid(),
  trip_id text references trips(id) on delete cascade,
  name text not null,
  device_id text default null, -- Added to bind identity claims to browser instances
  joined_at timestamptz default now()
);

-- 3. Create Expenses Table
create table expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id text references trips(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  member_name text not null,
  category text not null,
  amount numeric not null,
  note text,
  created_at timestamptz default now()
);

-- 4. Disable RLS for easy frontend querying
alter table trips disable row level security;
alter table members disable row level security;
alter table expenses disable row level security;

-- 5. Enable Real-Time notifications on members and expenses tables
alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table members;

-- NOTE: If you already created these tables, run this command in your SQL editor:
-- ALTER TABLE members ADD COLUMN device_id text default null;
```

---

## Getting Started Locally

1. Clone or download the project files:
   - `index.html`
   - `style.css`
   - `app.js`
2. Open `index.html` directly in any web browser, or launch it with a local development server (e.g. VS Code Live Server, or `npx http-server`).
3. Click the **Database Node** icon `(⚙️/🌐)` in the top header:
   - Enter your **Supabase URL** (found under *Project Settings -> API*).
   - Enter your **Supabase Anon Key** (found under *Project Settings -> API*).
   - Save credentials (stored securely in your browser's `localStorage`).
4. **Offline Mode**: Toggle to the **Quick Split** tab to split bills locally without configuration.
5. **Trip Mode**: Toggle to the **Trip Mode** tab:
   - Click "Create Session", input a trip name, and your name.
   - An invite link with a trip hash code (e.g. `spliteasy.in/trip#TRIP-XYZ12`) will be generated.
   - Share this link or code with friends to let them join the collaborative ledger.

---

## Features Walkthrough

### 1. Custom Category Splitting (Quick Split & Trip Mode)
Add items or expenses line-by-line (e.g., Food = ₹12,000, Drinks = ₹3,000). Check/uncheck members who participated in each item. The app dynamically splits each category amount among its participants and sums up the individual shares.

### 2. Settle Up (Greedy Algorithm)
Under **Suggested Settlement**, the app calculates outstanding balances and reduces circular debts into the minimum number of transactions (e.g., Bob pays Charlie ₹2,000 instead of Bob paying Alice and Alice paying Charlie).

### 3. Trust-Based UPI Receipt Flow
- **Debtors** click the **Pay UPI** button next to a suggested transaction to view the creditor's name, amount, and a simulated UPI QR Code. 
- Clicking **I Have Paid Owed Amount** inserts a transaction with status `pending_confirmation`.
- **Creditors** see a real-time notification on their dashboard with a **Confirm Receipt** button.
- Clicking **Confirm Receipt** updates the status to `confirmed`, settling the balances.
