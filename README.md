## v12 — ZKTeco live sync, invoice advance deduction fix

### Migrations
Run, in order, any of these you haven't yet: `migration_13.sql` (device sync keys), `migration_14.sql` (invoice advance field).

### Fixed: advance was inflating revenue
Corrected per your feedback — advance payments no longer get ADDED on top of invoice revenue (that was double-counting). Now:
- **Invoices**: add "Advance already received" — auto-filled from payments logged against the linked order, editable. The invoice shows Subtotal, minus Advance Received, equals **Balance Due** — both on-screen and on the printed invoice. The invoice list also shows a Balance Due column.
- **Finance revenue**: reverted to counting each invoice's full (gross) amount only — the advance is part of that same amount, not extra. Advance payments still show as their own informational figure ("Advance payments received") so you can see cash collected, without it inflating revenue.

### ZKTeco live device sync
Since your device is ZKTeco, real live sync is genuinely buildable — here's what's included:

- **In the app**: Attendance tab → "Live device sync setup" (admin only) — generate a secret sync key here. This key can only ever do one thing: upsert one attendance punch. It cannot read or touch anything else in your database, unlike your full Supabase credentials would be able to — safe to keep on a factory PC.
- **`device-sync/` folder** in this project: a ready-to-run Python script (`zk_sync.py`) using the widely-used `pyzk` library, which connects to your ZKTeco device over your factory's local network, reads today's punches, groups them into check-in/check-out per employee per day, and pushes them to the app using the sync key above. Full setup instructions are in `device-sync/README.md`.

**Important — this script runs on a local PC, not in the cloud.** Your ZKTeco device lives on your factory's local network and isn't reachable from the internet (completely normal). So this script needs an always-on computer on the *same* network as the device — an office PC, a small mini-PC, or a Raspberry Pi — to bridge the two. Once set up, schedule it to run every 5–15 minutes (Windows Task Scheduler or cron — instructions included) and attendance will flow in automatically all day.

One more requirement: each employee's **Employee Number** in the app must match their **User ID as enrolled on the ZKTeco device**, so the script knows who's who. Set this once per employee in the Employees tab.

`pyzk` supports most common ZKTeco models. If the script can't connect once you try it, send me your exact device model number (usually on a label on the unit) and I'll help troubleshoot.

## v11 — advance-in-revenue, attendance shift rules, biometric CSV import

### Migration
Run `supabase/migration_12.sql` (adds check-in/check-out columns to attendance).

### What's new
- **Advance payments now count as revenue.** Finance → Overview and Order Profitability both show Revenue as invoiced amount + advance payments received. Each order card shows the breakdown (e.g. "₹8,000 invoiced + ₹2,000 advance"). One thing to keep in mind yourself: if you later raise a formal invoice for money that was already logged as an advance, that same amount would count twice unless you account for it (e.g. show the invoice as the advance amount less what's already been paid). This app doesn't auto-reconcile that for you.
- **Attendance now tracks check-in/check-out times** against a 9:00 AM – 6:00 PM shift, with a 9-hour minimum for a full Present day. Enter times in the Attendance tab and it auto-flags **Late** arrivals and **Overtime** hours, and suggests a status (still fully overridable).
- **CSV import for biometric attendance** — "Import from device" button on the Attendance tab. Export your biometric software's log to CSV (employee number/name, date, check-in, check-out) and paste it in; the app matches employees and bulk-imports.

### About live biometric device integration
Direct real-time connection from this cloud app to a physical device on your factory's local network isn't something that can be built generically — it depends entirely on your specific device brand/model:
- Some newer devices (many ZKTeco models, for example) support pushing data straight to a cloud URL. If yours does, a small receiving endpoint could be built to accept it automatically.
- Most devices don't support that, and instead need a small always-on helper program running on a PC on the same local network as the device, which reads the punches (via the device's SDK) and uploads them to this app on a schedule.
- The CSV import above works **today**, with any device, since virtually all biometric attendance software can export to Excel/CSV — this is the practical way to get your data in while a live-sync option (if wanted) is scoped separately once the device's brand/model is known.

# T&P Textiles — Workshop Management

A real, hosted version of your workshop management app: employees, orders (with
multi-item production tracking, planned dates, partial deliveries, and manpower
assignments), a public customer order-tracking page, invoices (with print),
attendance, payroll (with payslips), sales team tracking, field expense claims,
a Finance module (investors, business expenditures, per-order profit & loss
with automatic labor and raw-material cost calculation), and a dedicated User
Management area. Has its own permanent URL, a real database, real login
accounts, updates live across everyone using it, and installs like a real app
on phones.

## Updating an existing deployment

If you already deployed the app and have live data, **don't re-run schema.sql**
— run only the migration file(s) you haven't run yet, in this order:

1. Open your Supabase project → **SQL Editor** → New query.
2. Run `supabase/migration_2.sql` if you haven't already.
3. Run `supabase/migration_3.sql` if you haven't already.
4. Run `supabase/migration_4.sql` if you haven't already.
5. Run `supabase/migration_5.sql` if you haven't already.
6. Run `supabase/migration_6.sql` if you haven't already.
7. Run `supabase/migration_7.sql` (role invitations / User Management) — new query, paste, Run.
8. Run `supabase/migration_8.sql` (link expenditures to orders) — new query, paste, Run.
9. Replace your app code with this new version and redeploy.

**If you're not sure which migrations you've already run**, run them in order
starting from the first one you haven't — running one twice is safe (they all
use `if not exists` / `if exists` guards), it just does nothing the second time.

### What's new in this version

**Dedicated "User Management" tab (admin-only)**
- Moved out of Employees — admins are logins, not necessarily employees, so these are now clearly separate concepts.
- **Existing accounts**: change anyone's role (Admin / HR / Staff) from a dropdown.
- **Invite with a specific role**: since this app can't set someone's password for them directly (that needs a Supabase Edge Function with a service-role key — extra server infrastructure beyond what's here; ask if you want that built), you can instead pre-assign a role to an email address. Share the app link, they use "Create account" with that exact email, and they land with the role you chose instead of the default Staff role.

**Expenditures can now be linked to a specific order**
- When adding an expenditure, there's a new "Is this for a specific order?" dropdown — pick the order it was for (e.g. fabric bought specifically for Order ORD-0012), or leave it as "Other."
- The Expenditures list now shows which order (if any) each entry belongs to.
- In Finance → Order Profitability, an order's **raw material cost now auto-totals** from any expenditures linked to it — same pattern as the automatic labor cost. If nothing's linked, the manual entry field is still there.

**Errors are no longer silent**
- Previously, if saving an order or expenditure failed (e.g. a permissions issue or a migration not yet run), the app would fail quietly with no explanation. Now you'll get a clear on-screen message with the actual database error, and failed loads are logged to the browser console (F12 → Console) so problems are diagnosable instead of just "nothing happens."

---

## Feature history (previous versions)

### v8 — HR role, automatic labor cost


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


### v4 — order tracking, deliveries, customer page
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
