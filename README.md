# T&P Textiles — Workshop Management

A real, hosted version of your workshop management app: employees, orders (with
multi-item production tracking, planned dates, partial deliveries, and manpower
assignments), a public customer order-tracking page, invoices (with print),
attendance, payroll (with payslips), sales team tracking, field expense claims,
and a Finance module (investors, business expenditures, per-order profit &
loss with automatic labor cost calculation). Has its own permanent URL, a
real database, real login accounts, updates live across everyone using it,
and installs like a real app on phones.

## Updating an existing deployment

If you already deployed the app and have live data, **don't re-run schema.sql**
— run only the migration file(s) you haven't run yet, in this order:

1. Open your Supabase project → **SQL Editor** → New query.
2. Run `supabase/migration_2.sql` if you haven't already (orders items/progress, payroll linking).
3. Run `supabase/migration_3.sql` if you haven't already (expense claims + receipt photo storage).
4. Run `supabase/migration_4.sql` if you haven't already (planned dates, delivery tracking, customer tracking page).
5. Run `supabase/migration_5.sql` if you haven't already (investors, expenditures, order profitability).
6. Run `supabase/migration_6.sql` (HR role, automatic labor cost tracking) — new query, paste, Run.
7. Replace your app code with this new version and redeploy.

Your existing data is untouched by any of these.

### What's new in this version

**New role: HR**
- Access to **Dashboard** and **Attendance** only — nothing else (no Orders, Invoices, Payroll, Employees, Finance, Sales).
- Can mark/edit attendance for any employee, same as Admin could before.
- Assign the HR role (or promote/demote anyone) from **Employees → Login accounts** — no more needing to edit the Supabase table editor by hand for role changes.
- This is enforced at the database level: a new `is_admin_or_hr()` check controls attendance write access specifically; every other admin-only table (Employees, Orders, Payroll, Finance, etc.) still requires the `admin` role exactly, so HR can't accidentally get broader access.

**Dashboard: unpaid invoice data is now Admin-only**
- Staff and HR no longer see the "Unpaid invoices" figure or the "Overdue invoices" list — that panel now only renders for Admin, and the underlying data isn't even fetched for non-admins.
- Staff/HR see a "Sales team" count in that stat card's place instead, so the layout stays balanced.

**Automatic labor cost calculation**
- In the Orders tab, a new people-icon button lets you log which employees worked on an order, and on which dates (multi-select staff + a date, repeatable).
- Finance → Order Profitability now **auto-calculates labor cost, manpower count, and man-days** from those assignments (each employee's daily wage = their monthly base salary ÷ days in that month), instead of requiring a manual number.
- If no assignments are logged for an order, the old manual entry fields are still there as a fallback — nothing is forced.
- This assignment data is admin-only at the database level, same protection level as the rest of the Finance module.

### Finance module (admin-only) — from the previous version
A **Finance** tab, visible only to Admin accounts, with four sections:

- **Overview** — total invested, total expenditure, total revenue (from invoices), and a rough cash position estimate.
- **Investors** — add investors (name, phone, email, notes); each investor can have **multiple investment entries** over time (amount + date + notes), with running totals per investor and overall.
- **Expenditures** — a general ledger for business purchases: Raw Material (fabric, buttons, trims), Machinery, Utilities, Rent, Maintenance, Other. Filterable by month, with a category breakdown.
- **Order Profitability** — for every order: revenue is pulled automatically from any invoices linked to it. Total cost, profit, and profit margin % are calculated per order, plus totals across all orders.

**Security note on the Finance module:** investor money and per-order profit margins are the most sensitive numbers in the business, so this data is locked down at the *database* level, not just hidden from the Staff role in the menu. A Staff-role login has zero access to investors, investments, expenditures, or order cost/profit/labor-assignment data even if they tried to query it directly — this is stricter than every other module in the app.


---

## Installing it like an app (works today, no store needed)

This version adds a proper app icon, name, and "Add to Home Screen" support.
Once redeployed:

**On Android (Chrome):** open your app URL → tap the ⋮ menu → **Install app** (or you'll see an automatic "Add T&P Textiles to Home screen" banner). It installs with your logo, opens full-screen without browser address bars, and behaves like a normal app.

**On iPhone (Safari):** open your app URL → tap the Share icon → **Add to Home Screen**. Same result — real app icon, full-screen, no Safari UI.

This costs nothing, needs no approval process, and updates instantly whenever you redeploy — most small businesses stop here.

---

## Getting listed on the Apple App Store & Google Play Store

I can't submit apps to either store myself — both require the store account to
be owned and paid for by you (or T&P Textiles as a business), since Apple and
Google tie every listing to a verified developer identity and payment method.
Here's the real path, using **PWABuilder** (a free Microsoft tool built exactly
for turning a web app like this into store-ready app packages):

### Google Play Store
1. Create a [Google Play Console](https://play.google.com/console) account — **$25 one-time fee**.
2. Go to [pwabuilder.com](https://www.pwabuilder.com), enter your live app URL, and click **Package for stores → Android**.
3. It generates a signed `.aab` file (Android App Bundle) ready to upload.
4. In Play Console: create a new app, fill in the store listing (description, screenshots, privacy policy URL), upload the `.aab`, and submit for review.
5. Google's review is usually quick (hours to a couple of days) for straightforward business apps like this.

### Apple App Store
1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) — **$99/year**. You'll need a Mac to complete the final build step.
2. On [pwabuilder.com](https://www.pwabuilder.com), enter your app URL and click **Package for stores → iOS**. It generates an Xcode project.
3. Open that project in Xcode (Mac required), sign it with your Apple Developer account, and build the archive.
4. Submit through **App Store Connect** with your listing details, screenshots, and privacy policy URL.
5. **Be aware:** Apple's review guideline 4.2 ("Minimum Functionality") sometimes rejects apps that are thin wrappers around a website. This app has enough real functionality (offline shell, native install, camera access for receipt photos, etc.) to have a reasonable case, but Apple's review is subjective — if rejected the first time, they'll tell you exactly why and you can usually address it and resubmit.

### Before submitting to either store, you'll also need
- A **privacy policy page** (required by both stores) — I can draft one for T&P Textiles if you'd like, covering what data is collected (employee records, attendance, payroll, expense receipts) and that it's for internal business use.
- **App screenshots** — a few screenshots of the Dashboard, Orders, and Invoices screens on a phone.
- A short **app description** for the store listing.

If you'd like, I can prepare the privacy policy, store description text, and screenshots next — just say so.


### What's new in this version
- **Fuller status pipeline**: Not Started → Cutting → Stitching → Finishing → Ironing → Completed → Shipped.
- **Planned start / end dates** on every order, shown alongside the customer's due date.
- **Delivery tracking**: log partial deliveries per item (e.g. "delivered 40 of 60 T-shirts today, rest next week") from the truck icon on each order. The order card now shows, per item: how many are made, how many delivered, and how many are still pending — so you can keep a customer happy with a partial shipment without losing track of what's owed.
- **Dashboard** "Orders in progress" card now shows each order's current stage and planned dates, not just due date.
- **Public customer tracking page** — no login needed. Click the link icon on any order to get a shareable URL + short tracking code; send it to the customer (SMS/WhatsApp) and they can check status, current stage, and how many of each item are completed/delivered/pending, any time.
  - The tracking page lives at `yourapp.com/?track=1` — if a customer opens it without a link they can still type in the order number and tracking code manually.
  - This uses a locked-down database function: it only ever returns one order's summary, and only if both the order number AND its private tracking code match — it can't be used to browse or guess other orders.

### From earlier versions
- Multiple line items per order; order value/price removed (orders track production, invoices carry price).
- Hourly production tracking on each order.
- Staff can see their own Payroll (present days, leaves, net pay) and generate their own payslip.
- Staff can submit expense claims (Food/Petrol/Transport/Other) with a receipt photo; admin reviews and marks Approved/Rejected/Reimbursed.



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
