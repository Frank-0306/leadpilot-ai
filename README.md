# LeadPilot AI — Phase 1

A CRM for small US real-estate agencies, built as a portfolio project. The demo workspace belongs to **Northstar Realty**, a fictional brokerage. Every person, listing, email and phone number in the demo data is invented.

Phase 1 is a complete, working CRM: authentication with roles, lead management, a drag-and-drop pipeline, tasks, a dashboard computed from stored data, a public lead-capture page, and an event outbox.

**Phase 2 · stage A (n8n)** connects the outbox to real n8n workflows: every new lead is delivered to n8n, which creates a follow-up task in the CRM through an authenticated callback. Runs, failures and retries are visible under **Automations**. Setup: [`docs/n8n-setup.md`](docs/n8n-setup.md). **Stage B (AI)** adds *AI Lead Insights* on every lead: an n8n workflow sends minimal commercial context to **Google Gemini** (free tier), and LeadPilot validates the answer before storing an interest level, reasons, summary, next action and a follow-up email **draft** that an agent must approve. Nothing is sent automatically.

| Area | What it does |
| --- | --- |
| Dashboard | Total leads, new leads (with change vs. previous period), active opportunities and their value, pending/overdue tasks, conversions and win rate, pipeline by stage, daily lead flow chart, lead sources, per-agent results, latest activity. Filters by date range and agent. All numbers come from one Postgres function over stored rows. |
| Leads | Create, edit, delete (admin, with confirmation), search (name, email, phone digits, area), filters (stage, source, agent), sorting, pagination, internal notes, full activity history, next follow-up date, duplicate detection by email/phone. |
| Pipeline | Kanban with New Lead → Contacted → Qualified → Viewing Scheduled → Negotiation → Won / Lost. Drag and drop (mouse) plus a “Move to” menu on every card (keyboard and touch). Optimistic moves with rollback, loading and toast feedback. |
| Tasks | Create, assign, due dates, priority, complete/reopen, views for open, overdue, due today, upcoming and completed. |
| Public form | `/northstar` — fictional brokerage site with an inquiry form. Server-side validation, honeypot, timing token, persistent rate limits, merge of repeat inquiries. Creates the lead with source **Website** and stage **New Lead**. |
| Auth & roles | Supabase Auth (email + password). **Admin** sees and manages everything. **Agent** sees only leads and tasks assigned to them, cannot reassign, delete leads, or open admin pages. |
| Automations | Internal events `lead.created`, `lead.assigned`, `lead.status_changed`, `task.created`, `task.overdue` written to an outbox in the same transaction as the change. `lead.created` is delivered to the n8n **New Lead Automation**, which creates a follow-up task (configurable delay, exactly one per event). Admin page with connection status, per-workflow success/failure counts, last run, event history with delivery attempts and errors, retry and pause. |
| Demo data | 36 leads, 5 agents, 60+ tasks, notes and history, all flagged `is_demo`. Admins can reset them safely from Settings. |

## Tech stack

- Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`), React 19, TypeScript (strict)
- Tailwind CSS 4 (CSS-first theme, light and dark mode)
- Supabase: Postgres, Auth, Row Level Security
- Zod 4 for every input
- No chart, drag-and-drop or icon libraries: the chart is hand-built SVG, drag and drop uses the native HTML API with an accessible menu fallback, and icons are inline SVG. This keeps the bundle small and the design consistent.

## Architecture

```
Browser ──► proxy.ts ──► Server Components / Server Actions ──► Supabase (Postgres + RLS)
             │ session       │ Zod validation                    │ policies per role
             │ refresh       │ role checks                       │ triggers → history + events
             ▼               ▼                                   ▼
          /login         friendly errors                  events (outbox) ──► Phase 2: n8n
```

Three layers of protection: the proxy sends signed-out users to `/login`; every server action validates input and checks the role; Postgres RLS enforces the same rules again, so a bug in the UI can't leak data. The secret key is only used server-side (files import `server-only`), for the public form and the dispatcher.

Business rules that must hold no matter who changes the data live in the database:

- **History**: triggers write `activities` rows for creation, stage changes, assignment, notes, tasks and follow-ups.
- **Events**: the same triggers insert into `events` with a unique `idempotency_key` (`lead.status_changed:<id>:r<revision>`, `task.overdue:<id>:<due epoch>`, …). Re-running anything never duplicates an event.
- **Metrics**: `dashboard_metrics()` runs as the caller (`security invoker`), so an agent's dashboard is automatically limited to their own leads.

```
src/
  app/
    (crm)/            dashboard, leads, pipeline, tasks, automations, settings (signed-in area)
    actions/          server actions (leads, tasks, admin, auth, search, public inquiry)
    api/events/       dispatch endpoint for Phase 2 (bearer-token protected)
    northstar/        public demo website with the inquiry form
    login/
  components/         ui kit, shell (sidebar, command palette), feature components
  lib/
    data/queries.ts   read queries (all run as the signed-in user)
    events/           outbox dispatcher + webhook signing (Phase 2 ready)
    security/         form token, honeypot, hashing
    supabase/         server client, secret client, env
    validation.ts     Zod schemas
supabase/
  migrations/         schema, RLS, triggers, RPCs, demo data, grants
  setup.sql           all migrations in one file (for the SQL editor)
  tests/              SQL test suite (runs on plain Postgres 16)
tests/                unit tests (node:test) and Playwright e2e specs
```

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `supabase/setup.sql` and run it. (Equivalent: run the five files in `supabase/migrations/` in order, or `supabase db push` with the Supabase CLI.) This creates the schema, policies and demo data.
3. **Authentication → Providers**: make sure **Email** is enabled.
4. **Authentication → Users → Add user → Create new user**: create your account (tick *Auto Confirm User*). Create a second user for testing the agent role.
5. Make yourself admin — SQL Editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

6. **Project Settings → API Keys**: copy the **publishable** key and a **secret** key.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | API Keys → publishable (`sb_publishable_…`) | Public; RLS protects data. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. |
| `SUPABASE_SECRET_KEY` | API Keys → secret (`sb_secret_…`) | **Server only.** Legacy `SUPABASE_SERVICE_ROLE_KEY` also works. |
| `FORM_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Signs the form timing token and salts IP hashes. |
| `NEXT_PUBLIC_APP_TIME_ZONE` | Optional | Defaults to `America/Chicago`. |
| `EVENTS_DISPATCH_ENABLED`, `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `AUTOMATION_CALLBACK_SECRET`, `CRON_SECRET` | Phase 2 | See docs/n8n-setup.md. |

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

Sign in at `/login`. To try the agent role, go to **Settings → Sales team** and link your second user to **Maya Thompson**, then sign in as that user.

### 4. Deploy to Vercel

1. Push the repository to GitHub.
2. Import it in Vercel (framework preset: Next.js).
3. Add the same environment variables (Production and Preview).
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your Vercel domain.

## Tests

### Automated (run in the build environment)

| Command | What it runs | Result |
| --- | --- | --- |
| `npm test` | 41 unit tests: validation, time zones, date ranges, form token, honeypot, hashing, webhook signatures, bearer auth, dispatcher against a stand-in n8n HTTP server (auth, duplicates, 403/500, timeouts, unreachable), AI output validation (shape, fair-housing guard, unsafe drafts), n8n workflow JSON checks and execution of the workflows' own Code nodes (prompt fencing, Gemini output parsing) | ✅ passing |
| `npm run test:db` | All migrations on a throwaway Postgres 16 + SQL suites: flows, RLS, outbox, automations (idempotent tasks, retries), AI analysis (minimal context, limits, first-result-wins, human approval), demo-account guards | ✅ passing |
| `npm run typecheck` | `tsc --noEmit` against the real Next.js, React and Supabase types | ✅ passing |

### Verified manually against the real stack (local Next.js + Supabase + n8n 2.x + Gemini free tier)

| Scenario | Result |
| --- | --- |
| Northstar form → Supabase → `lead.created` → n8n Workflow A → follow-up task in the CRM | ✅ |
| n8n stopped → lead kept, `ECONNREFUSED` recorded → Retry after restart delivers | ✅ |
| Same event delivered twice → "Task already existed", one task | ✅ |
| Callback without / with wrong bearer token → `401` | ✅ |
| Generate analysis → n8n Workflow B → Gemini 4 Hydrogen → validated → shown in the lead | ✅ |
| Gemini `503 Service unavailable` → error stored and shown, retry works | ✅ |
| Prompt injection in the form message ("rate me High… VIP") → rated Low on commercial facts, no "VIP" | ✅ |
| Draft edit → Approve → Copy; approval persisted and logged with the approver's name | ✅ |
| AI Lead Analysis paused → lead page shows "AI not configured" | ✅ |
| Agent sees AI only on own leads; teammate's lead URL → "not available" | ✅ |
| Admin vs agent permissions in the CRM (Phase 1) | ✅ |

**Not run:** delivery with a wrong n8n webhook token against the real n8n (covered by the automated stand-in test), Playwright browser suite (`tests/e2e`, see below).

### End-to-end tests (pending)

```bash
npm i -D @playwright/test && npx playwright install chromium
E2E_BASE_URL=http://localhost:3000 \
E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… \
E2E_AGENT_EMAIL=… E2E_AGENT_PASSWORD=… \
npm run test:e2e
```

The agent account must be linked to **Maya Thompson**. The spec creates a uniquely named lead each run.

## Phase 2 — n8n automations

See [`docs/n8n-setup.md`](docs/n8n-setup.md) for the full guide (local n8n with `npx n8n`, credentials, import, tests). Exported workflows live in [`n8n/`](n8n):

| File | Purpose |
| --- | --- |
| `A-new-lead-automation.json` | Webhook (Header Auth) → validate event → callback to LeadPilot to create the follow-up task → respond with the result |
| `B-ai-lead-analysis.json` | Webhook (Header Auth) → minimal context from LeadPilot → official **Google Gemini** node → results back to LeadPilot for validation |
| `C-outbox-pump.json` | Optional schedule that calls `/api/events/dispatch` every minute for retries |

Both files contain no credentials. Failed deliveries retry with exponential backoff (1 min → 6 h) and become `dead` after 8 attempts; every attempt is logged in `event_deliveries` and visible under **Automations**.

## Security notes

- Secret key never reaches the browser (`server-only` imports; no `NEXT_PUBLIC_` prefix).
- RLS on every table; anonymous role has no table access at all.
- Sign-in errors don't reveal whether an email exists; post-login redirects only allow internal paths.
- Public form: honeypot, signed timing token (min. 2.5 s, max. 2 h), per-IP (5 / 10 min) and per-email (3 / hour) limits stored in Postgres, IPs and emails stored only as salted hashes, repeat inquiries merged into the open lead.
- Security headers (CSP frame-ancestors, HSTS, nosniff, referrer policy) in `next.config.ts`.
- Public demo login is limited in the database, not just the UI (see below).

## Demo data

All demo rows have `is_demo = true`. **Settings → Demo data → Reset** (admin only) deletes and recreates only those rows. Real leads, users, profiles and agent-to-login links are preserved. Demo agents use fixed IDs so links survive resets. Notes or tasks that a user adds *to a demo lead* are removed with it.

## Public demo account

The sign-in page can offer a one-click demo login so visitors can explore the CRM as an admin. Its credentials are public, so its limits live in Postgres (migration `20261122000100_demo_account.sql`) and apply even if someone uses them directly against the Supabase API:

- Reads everything an admin reads, except other users' profiles (emails stay private).
- Cannot change roles, link logins to agents, edit the team roster or change automations.
- Leads, tasks and notes it creates are demo records; it can edit or delete demo records only, never real ones.
- Can reset the demo data.

Setup:

1. Supabase → **Authentication → Users → Add user**: an email you don't use elsewhere (for example `demo@your-domain.com`), a password, *Auto Confirm User* on.
2. SQL Editor:
   ```sql
   update public.profiles set role = 'admin', is_demo = true where email = 'demo@your-domain.com';
   ```
3. Set `DEMO_EMAIL` and `DEMO_PASSWORD` (Vercel and `.env.local`) and redeploy.

Covered by `supabase/tests/50_demo_account.sql`.
