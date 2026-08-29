# T&P Textiles — Workshop Management

A real, hosted version of your workshop management app: employees, orders (with
multi-item + hourly production tracking), invoices (with print), attendance,
payroll (with payslips), sales team tracking, and field expense claims. Has its
own permanent URL, a real database, real login accounts, and updates live
across everyone using it.

## Updating an existing deployment

If you already deployed the app and have live data, **don't re-run schema.sql**
— run only the migration file(s) you haven't run yet, in order:

1. Open your Supabase project → **SQL Editor** → New query.
2. Run `supabase/migration_2.sql` if you haven't already (orders items/progress, payroll linking).
3. Run `supabase/migration_3.sql` (expense claims + receipt photo storage) — new query, paste, Run.
4. Replace your app code with this new version and redeploy.

Your existing data is untouched by either migration.

### What's new in this version (expense claims)
- **Staff can submit expense claims** for Food, Petrol, Transport, or Other — with
  amount, date, notes, and an optional **receipt photo upload** (works from a phone camera).
- When category is Petrol or Transport, staff also pick a **mode of transport**
  (Bus, Auto, Own Vehicle, Train, Other).
- Claims appear under the **Sales Team** tab — staff see only their own; admins
  see everyone's, with a "pending" count badge.
- **Admin can review each claim**: view the receipt photo, add a note, and mark
  it Approved, Rejected, or Reimbursed.
- Receipt photos are stored privately in Supabase Storage — only the employee
  who uploaded it and admins can view it (enforced by storage security rules,
  not just the app's UI).
- This reuses the same "linked employee account" system from Payroll — a staff
  member needs their login linked to an employee record (Payroll tab → admin)
  before they can submit claims, same as for viewing their own payroll.

### What's new from before that (v2 — orders & payroll)
- Orders now support multiple line items (e.g. T-shirts × 200, Pants × 100); order value/price was removed — orders track production quantities only.
- Hourly production tracking on each order, with a "today's production progress" card on the Dashboard.
- Staff can see their own Payroll (present days, leaves, net pay) without seeing anyone else's.
- Admins can generate printable payslips for any employee, any month; staff can generate their own.



## What you get
- **Its own web address** you can bookmark and open from any browser/phone — no Claude needed
- **Real accounts** (Supabase Auth) — proper email + password login, not a shared password
- **Two roles**: Admin (everything) and Staff (invoices only)
- **Live sync** — if one manager updates an order, everyone else sees it update automatically
- **A free hosting plan is enough** for a business this size

Total setup time: about 15 minutes, and it's free on the plans below.

---

## Step 1 — Create your database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New project**. Pick any name (e.g. `tp-textiles`), set a database password
   (save it somewhere), and choose a region close to India.
3. Once the project is ready, go to the **SQL Editor** (left sidebar).
4. Open the file `supabase/schema.sql` from this folder, copy **all** of it, paste it
   into the SQL Editor, and click **Run**. This creates all your tables and security rules.
5. Go to **Project Settings → API**. You'll need two values from this page in Step 3:
   - **Project URL**
   - **anon public** key

---

## Step 2 — Get the code running on your computer (optional but recommended first)

You'll need [Node.js](https://nodejs.org) installed (any recent version).

1. Unzip this project folder and open a terminal inside it.
2. Copy the environment file:
   ```
   cp .env.example .env
   ```
3. Open `.env` and paste in your Project URL and anon key from Step 1.
4. Install and run:
   ```
   npm install
   npm run dev
   ```
5. Open the link it prints (usually `http://localhost:5173`). You should see the login screen.

---

## Step 3 — Create your first (admin) account

1. On the login screen, click **Create account**, fill in your name, email, and a password.
2. By default every new account starts as **Staff**. To make yourself an **Admin**:
   - Go to your Supabase project → **Table Editor** → `profiles` table.
   - Find the row with your name/email, click into the `role` cell, change it from
     `user` to `admin`, and save.
3. Refresh the app and log in again — you'll now see all tabs (Employees, Orders,
   Attendance, Payroll, Sales Team, Invoices).

From here on, you (as admin) can create more accounts, or your managers/staff can
use **Create account** themselves and you promote the ones who need admin access the
same way.

---

## Step 4 — Put it on the internet with a real URL (Vercel)

1. Push this project to a GitHub repository (or use Vercel's "drag and drop deploy" —
   see below for the no-GitHub option).
2. Go to [vercel.com](https://vercel.com), sign up free, click **Add New → Project**,
   and import your repository.
3. When it asks for **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. Click **Deploy**. In about a minute you'll get a live URL like
   `https://tp-textiles.vercel.app` — that's your permanent app address.

### No-GitHub option
If you don't want to use GitHub, you can install the Vercel CLI instead:
```
npm install -g vercel
vercel
```
Follow the prompts (it will ask you to log in and will detect the project automatically),
then run `vercel --prod` to publish. It will ask for the same two environment variables.

---

## Day-to-day use after this

- Bookmark your Vercel URL on every phone/computer that needs access.
- Each manager creates their own account (or you create it and share the password once).
- Only you (admin) can edit Employees, Orders, Attendance, Payroll, and Sales Team.
- Both admin and staff can create and print invoices.
- Data is safe permanently in Supabase — closing the browser, restarting your phone,
  or anything happening to this Claude conversation has no effect on it.

## Costs
- Supabase free tier: enough for a business your size (up to 500MB database, 50,000
  monthly active users).
- Vercel free tier: enough for this kind of internal tool.
- You can run this forever at ₹0/month unless your usage grows dramatically.

## If something breaks
- **Blank page / login doesn't load**: double check `.env` (or Vercel's environment
  variables) have the correct Supabase URL and anon key, then redeploy.
- **"row-level security" errors when saving**: means you're logged in as Staff and
  trying to do something admin-only (e.g. add an employee) — expected behavior.
- **Can't log in as admin**: check the `profiles` table in Supabase to confirm your
  role is set to `admin`, not `user`.
