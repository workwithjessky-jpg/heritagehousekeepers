# Heritage Housekeepers | Operations Hub

Scheduling, GPS attendance, timesheets, payroll estimates, client/property CRM, checklists, quality control,
notifications and reporting for Heritage Housekeepers.

- **Management portal** — `/admin` (Owner, Operations Manager, Office Administrator)
- **Cleaner portal** — `/app` (mobile-first; each cleaner sees only their own data)

**Stack:** Next.js 15 (App Router, React 19, TypeScript) · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, Realtime)
· Leaflet + OpenStreetMap maps · Resend email · deploys to Vercel.

---

## 1. What you need to provide

| Credential | Where to get it | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | **Yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (anon / publishable key) | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page (service_role / secret key). **Server only.** | **Yes** (creating employee logins, cron jobs) |
| `NEXT_PUBLIC_SITE_URL` | Your app URL, e.g. `https://ops.heritagehousekeepers.com` | Yes in production |
| `CRON_SECRET` | Any long random string (e.g. `openssl rand -hex 32`) | Yes in production |
| `RESEND_API_KEY`, `EMAIL_FROM` | resend.com → API Keys; a verified sending domain | Optional (email notifications) |
| `GOOGLE_MAPS_API_KEY` | Google Cloud → Geocoding API | Optional (address lookup; OpenStreetMap is used otherwise) |
| `TWILIO_*` | twilio.com | Optional, future SMS / WhatsApp |

Maps use OpenStreetMap tiles, and navigation uses plain Google Maps links, so **no maps API key is required**.

## 2. Local setup

```bash
npm install
cp .env.example .env.local        # then fill in the Supabase values
```

### Create the database

Pick **one** option:

- **Supabase CLI:** `npx supabase link --project-ref <ref>`, then `npx supabase db push` (applies `supabase/migrations/*`).
- **SQL editor:** open Supabase → SQL Editor, paste the whole of `supabase/setup.sql`, then run it once on a new project.

The SQL creates the tables, row-level security policies, business-logic functions, storage buckets and starter checklist templates.

### Supabase Auth settings

1. Auth → Providers → Email: **turn off “Allow new users to sign up”**. Only the owner creates logins.
2. Auth → URL Configuration: set Site URL to `NEXT_PUBLIC_SITE_URL` and add `<site>/auth/confirm` to Redirect URLs.
3. Auth → Email Templates (*Invite user* and *Reset password*): change the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password`
   (use `type=recovery` in the reset template).
4. For production email volume, add custom SMTP under Auth → SMTP settings. The built-in sender is rate-limited.

### Create the first owner and run the app

```bash
npm run create-owner -- --email you@heritagehousekeepers.com --name "Your Name" --password "a-strong-password"
npm run dev                         # http://localhost:3000
```

Sign in as the owner, then:

1. Settings → set the time zone, pay frequency, overtime and attendance rules for your jurisdiction.
2. Clients → add clients and properties. Coordinates are looked up from the address; check the pin.
3. Employees → add cleaners, using an invitation email or a temporary password.

### Demo data (optional, testing only)

```bash
npm run seed:demo           # 3 demo cleaners, 3 clients, 4 properties, ~16 jobs this week
npm run seed:demo -- --clear
```

Every demo record has `is_demo = true` and shows a purple **DEMO** tag. Demo logins use `@heritage-demo.test`.

## 3. Tests

```bash
npm test             # typecheck + database workflow tests + FK-hint check
npm run test:db      # runs every migration in embedded Postgres and tests the 6 core workflows + RLS
```

`test:db` runs entirely offline with PGlite. It signs in as an owner, an operations manager, an office admin and two cleaners, and checks:

1. **Assignment.** A job is created and assigned. The cleaner is notified and can see the job. Other cleaners cannot see it or its entry codes.
2. **Clock-in.** Location-policy consent is required. GPS is captured and the geofence is checked. Duplicate clock-ins are blocked and managers are notified.
3. **Completion.** Clock-out is blocked while the checklist or photos are incomplete. Clock-out then creates a timesheet and marks the job Completed.
4. **Timesheets.** The cleaner submits. Office admins can only prepare, not approve. Manager edits are written to the audit trail. Missed-punch requests work.
5. **Payroll.** Gross pay is calculated, with optional overtime (daily or weekly), adjustments and configured deductions. Net pay stays blank unless deductions are configured. Payroll goes through approve → paid, which locks it.
6. **Time off.** Requesting notifies managers. Approving flags overlapping jobs as Needs Attention and blocks new assignments for those days.

It also checks the security boundaries: cleaners cannot see each other's pay, cannot promote themselves, cannot call internal functions, and cannot upload into another job's photo folder.

## 4. Deploying to Vercel

1. Push this folder to a GitHub repository and import it in Vercel.
2. Add every variable from `.env.example` under Project → Settings → Environment Variables.
3. Deploy. `vercel.json` schedules both background jobs once a day, which the free Hobby plan allows. For timely alerts, run them more often:
   - **Vercel Pro:** change the schedules in `vercel.json` to `*/10 * * * *` (attendance) and `*/5 * * * *` (notifications).
   - **Free alternative:** create two jobs at cron-job.org (or any scheduler) that call
     `https://<your-app>/api/cron/attendance` every 10 min and `https://<your-app>/api/cron/notifications` every 5 min,
     each with the header `Authorization: Bearer <CRON_SECRET>`.
   - `/api/cron/attendance` detects missed clock-ins and forgotten clock-outs. `/api/cron/notifications` sends queued emails.
4. In Supabase, update the Site URL and Redirect URLs to the production domain.

GPS and camera need **HTTPS**. Browsers will not share location over plain HTTP, except on `localhost`.

## 5. Architecture notes

- **Security lives in the database.** Every table has row-level security. Writes that carry business rules go through
  `SECURITY DEFINER` functions, which check the caller's role themselves. Examples: `clock_in`, `clock_out`, `assign_employee`,
  `review_timesheets`, `generate_payroll` and `review_time_off`. The rules hold even if someone calls the API directly.
- **Roles** come from Supabase `app_metadata`, which only the service role can set, so users cannot pick their own role at sign-up.
- **Configurable rules.** Pay frequency, period anchor, overtime (daily and/or weekly thresholds, multiplier, per-employee overrides),
  break auto-deduction, geofence radius, grace periods, travel buffers, photo requirements, job types and pricing are all
  rows in `company_settings` / `employee_profiles`. None of them are hard-coded.
- **Payroll** produces *estimated gross* pay from **approved** hours only. Taxes are never calculated. A net estimate is
  shown only when deductions are explicitly configured on an employee.
- **Location privacy.** GPS is read once when the cleaner taps Clock In or Clock Out, after they accept the
  location policy. There is no background tracking. If GPS fails, the cleaner can submit a reason, which creates an exception for a manager to review.
- **Notifications.** Database triggers write to `notifications` (in-app, pushed live via Supabase Realtime) and queue
  rows in `notification_deliveries` for email. SMS and WhatsApp senders are stubbed in `src/lib/notify/channels.ts`.
- **Audit log.** A trigger records changes to users, profiles, clients, properties, access codes, jobs, settings and payroll periods. RPCs add their own entries for approvals and edits.
- **Entry codes** live in a separate `property_access_codes` table. Cleaners can read them only from 24 h before to 12 h after an assigned job.

### Project layout

```
supabase/migrations/      SQL migrations (schema → RLS → business logic → storage → templates)
supabase/setup.sql        all migrations in one file (npm run db:bundle)
scripts/                  create-owner, seed-demo, test-db, check-fk-hints, bundle-sql
src/app/admin/            management portal pages + server actions (_actions/)
src/app/app/              cleaner portal pages + actions.ts
src/app/api/              CSV/Excel exports, cron endpoints
src/components/           UI kit, calendar, map, shells, notification bell
src/lib/                  Supabase clients, auth/role guards, formatting, export helpers, notification channels
```
