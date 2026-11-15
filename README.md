# SplitSync

SplitSync is a full-stack expense sharing application built to make group spending easier to track, split, and settle. It is designed for friends, roommates, trips, teams, and small groups that need a simple way to record shared expenses, see who owes whom, and keep working even when the network is unreliable.

The project combines a React PWA frontend, local-first IndexedDB storage, queued offline sync, Google authentication, an Express API, and PostgreSQL persistence.

## Project Intention

SplitSync was created to solve a familiar problem: shared expenses become messy when they live in chats, notes, screenshots, and memory. The goal is to provide one clean place where a group can:

- Create shared groups.
- Invite contributors.
- Add expenses with equal or custom splits.
- Track balances automatically.
- Record settlement payments.
- Keep a local copy of data for offline use.
- Sync changes back to the cloud when online.

The project also demonstrates a practical full-stack architecture with independent frontend and backend workspaces, Docker support, Google Sign-In, server-side persistence, and a progressive web app experience.

## Achievements

- Built a working full-stack expense splitting product with separate frontend and backend workspaces.
- Implemented Google ID token authentication and secure HTTP-only session cookies.
- Added group creation, invitations, membership status, and invite acceptance.
- Added expense creation, viewing, editing, deletion, comments, dates, equal splits, and custom amount splits.
- Added settlement payment records and balance calculations.
- Added offline-first local storage using Dexie and IndexedDB.
- Added a sync queue so locally created changes can be pushed to the backend when connectivity returns.
- Added a PWA configuration for installable app behavior.
- Added Docker and Docker Compose support for frontend, backend, and PostgreSQL.
- Added PostgreSQL schema initialization directly in the backend startup flow.

## Features

### Authentication

- Google Sign-In on the frontend.
- Google ID token verification on the backend.
- HTTP-only cookie-based session handling.
- Revocable sessions with logout and device cache cleanup.

### Groups

- Create new expense groups.
- View joined groups and pending invited groups.
- Invite existing users by email.
- Accept pending group invitations.
- Track member role and joined status.

### Expenses

- Add expenses with description, amount, date, and comments.
- Split expenses equally across selected members.
- Split expenses by custom amounts.
- View expense details.
- Edit existing expenses.
- Delete expenses.
- Search-ready expense view layout.

### Balances and Settlements

- Automatic group balance calculation.
- Personal summary showing how much you owe or can recover.
- Suggested settlement recipient based on group balances.
- Record payments between members.
- Combined activity history for expenses and settlements.

### Offline and Sync

- Local IndexedDB database powered by Dexie.
- Cached user, groups, members, expenses, and payments.
- Offline mode detection.
- Pending sync queue for local changes.
- Automatic queue processing when the app comes back online.
- Full `/api/sync` endpoint to refresh local state from the server.

### Progressive Web App

- Vite PWA setup.
- Auto-updating service worker registration.
- Standalone display mode.
- App manifest with SplitSync branding.

## Tech Stack

### Frontend

- React 19
- Vite
- Tailwind CSS 4
- Dexie
- dexie-react-hooks
- vite-plugin-pwa
- lucide-react
- motion
- date-fns

### Backend

- Node.js
- Express
- PostgreSQL
- pg
- google-auth-library
- cookie-parser
- cors
- dotenv
- esbuild
- tsx

### Infrastructure

- Docker
- Docker Compose
- Nginx for serving the production frontend container

## Project Structure

```text
splitsync/
├── Backend/
│   ├── db.js
│   ├── app.js
│   ├── auth.js
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
├── Frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── db.js
│   │   ├── session.js
│   │   ├── index.css
│   │   ├── main.jsx
│   │   └── lib/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vite.config.js
│   └── package.json
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Prerequisites

- Node.js 20 or newer recommended.
- npm.
- PostgreSQL, or Docker if you want to run the database in a container.
- Google OAuth Client ID for Google Sign-In.

## Environment Setup

Copy the example environment file:

```sh
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure the values in `.env`:

```env
# Backend
POSTGRES_DB=splitsync
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/splitsync
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=
SESSION_COOKIE_NAME=splitSyncSession
FRONTEND_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
PORT=3000

# Frontend
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_API_URL=
```

For local development, `COOKIE_SECURE=false` is expected because the app normally runs on plain HTTP. Production requires HTTPS and `COOKIE_SECURE=true`. An empty `VITE_API_URL` uses `/api` through the Vite or Nginx proxy.

Generate a session secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and put the result in `SESSION_SECRET`. Production rejects missing secrets, obvious placeholders, and values shorter than 32 bytes. Development generates a fresh random secret on startup when this setting is empty. A length check cannot establish entropy; use the generator.

## Multi-architecture Docker images

The repository includes two Compose files for publishing and deployment:

- `docker-compose.hub.yml` builds and publishes the backend and frontend images.
- `docker-compose.deploy.yml` pulls those images and starts the backend and frontend against an existing PostgreSQL database.

The images target `linux/amd64` and `linux/arm64`, which covers standard servers and 64-bit Raspberry Pi OS. The Dockerfiles use architecture-neutral Node and Nginx base images; use a 64-bit Raspberry Pi operating system for the ARM64 image.

Create a Docker Buildx builder and log in to your registry:

```sh
docker buildx create --name splitsync-builder --use
docker buildx inspect --bootstrap
docker login docker.io
```

Set build-time values. For the included deployment Compose file, leave `VITE_API_URL` empty to use the same-origin Nginx proxy, or use the public API origin for a separate API host. Nginx forwards `/api/*` from the frontend container to the Compose `backend` service:

```sh
# Linux/macOS
export DOCKERHUB_NAMESPACE=your-dockerhub-username
export IMAGE_TAG=1.0.0
export VITE_GOOGLE_CLIENT_ID=your-google-client-id
export VITE_API_URL=
```

```powershell
# Windows PowerShell
$env:DOCKERHUB_NAMESPACE = "your-dockerhub-username"
$env:IMAGE_TAG = "1.0.0"
$env:VITE_GOOGLE_CLIENT_ID = "your-google-client-id"
$env:VITE_API_URL = ""
```

Build and push the multi-platform images:

```sh
docker compose -f docker-compose.hub.yml build --push
```

The Google client ID and Vite API URL are public frontend build configuration and are embedded in the frontend image. Do not bake `SESSION_SECRET`, database passwords, or other private values into an image; those are supplied at deployment time.

`DOCKERHUB_NAMESPACE` is the Docker Hub username or organization that owns the repositories. The build publishes `docker.io/<namespace>/splitsync-backend` and `docker.io/<namespace>/splitsync-frontend`.

To deploy, create a deployment `.env` file beside `docker-compose.deploy.yml`:

```env
DOCKERHUB_NAMESPACE=your-dockerhub-username
IMAGE_TAG=1.0.0
DATABASE_URL=postgres://postgres:postgres@db.example.com:5432/splitsync
GOOGLE_CLIENT_ID=your-google-client-id
SESSION_SECRET=<paste-the-generated-64-character-hex-value>
SESSION_COOKIE_NAME=__Host-SplitSync
FRONTEND_ORIGIN=https://app.example.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
FRONTEND_PORT=5003
BACKEND_PORT=3003
```

Then pull and start the stack:

```sh
docker login docker.io
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
docker compose -f docker-compose.deploy.yml ps
docker compose -f docker-compose.deploy.yml logs -f backend frontend
```

The deployment Compose file does not create or manage PostgreSQL. Set `DATABASE_URL` to the externally managed database. If PostgreSQL runs on the Docker host itself, use `host.docker.internal` instead of `localhost` in the connection URL; inside the backend container, `localhost` refers to the backend container.

For a cross-site frontend/API deployment, use HTTPS and set `COOKIE_SAME_SITE=none`; this also requires `COOKIE_SECURE=true`. Add the deployed frontend origin to the Google OAuth authorized JavaScript origins. To update, publish a new `IMAGE_TAG`, change the deployment `.env`, then run `pull` and `up -d` again.

## Google OAuth Setup

1. Open the Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID for a web application.
5. Add your local frontend origin, for example:

```text
http://localhost:5173
```

6. Put the client ID in both:

```env
GOOGLE_CLIENT_ID=
VITE_GOOGLE_CLIENT_ID=
```

The backend uses `GOOGLE_CLIENT_ID` to verify Google ID tokens. The frontend uses `VITE_GOOGLE_CLIENT_ID` to render Google Sign-In.

## Local Setup

Install dependencies from the root workspace:

```sh
npm install
```

Start PostgreSQL and make sure `DATABASE_URL` points to it.

Run the backend:

```sh
npm run backend:dev
```

Run the frontend in another terminal:

```sh
npm run frontend:dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health`

## Docker Setup

`docker-compose.yml` runs the local backend in development mode and serves the website at `http://localhost:5003`. It uses local settings independently of the `FRONTEND_ORIGIN`, cookie settings, and `VITE_API_URL` used by other environments. Set a generated `SESSION_SECRET` and both Google client ID variables in `.env`, and add `http://localhost:5003` to the Google OAuth client's authorized JavaScript origins.

The local defaults are:

```env
LOCAL_FRONTEND_ORIGIN=http://localhost:5003
LOCAL_COOKIE_SECURE=false
LOCAL_COOKIE_SAME_SITE=lax
LOCAL_SESSION_COOKIE_NAME=splitSyncDockerSession
LOCAL_VITE_API_URL=
```

An empty `LOCAL_VITE_API_URL` sends `/api` requests through Nginx on the website's origin. The proxy refreshes the backend's Docker DNS address after container replacements. Local Docker uses a separate session cookie because localhost cookies are shared across ports; sign in again after updating from the previous cookie name.

The Compose file also starts PostgreSQL. To connect the backend to that database, set `POSTGRES_URL=postgres` and `POSTGRES_PORT=5432` in `.env`. For an existing database on the Docker host, use `POSTGRES_URL=host.docker.internal` and that database's listening port. The published port `5435` is for host connections to the included database.

For production, use `docker-compose.deploy.yml` with the exact public HTTPS `FRONTEND_ORIGIN`, secure cookies, and HTTPS termination as described above.

Build and run the containers:

```sh
docker compose up --build
```

If your Docker installation uses the legacy Compose command:

```sh
docker-compose up --build
```

Container ports from the current Compose file:

- Frontend website: `http://localhost:5003`.
- Backend API listener: `3003`.
- PostgreSQL host listener: `5435`.

After changing local origin, cookie, or API settings, rebuild and recreate the application containers:

```sh
docker compose up -d --build --no-deps backend frontend
```

Reload the website after rebuilding so its service worker can install the updated app. The app shell and service worker are revalidated; offline account data remains in IndexedDB.

Stop the stack:

```sh
docker compose down
```

To intentionally remove the local database and all its data, also remove the volume:

```sh
docker compose down -v
```

## Available Scripts

Run the backend in development mode:

```sh
npm run backend:dev
```

Build the backend:

```sh
npm run backend:build
```

Start the built backend:

```sh
npm run backend:start
```

Run the frontend in development mode:

```sh
npm run frontend:dev
```

Build the frontend:

```sh
npm run frontend:build
```

Preview the frontend production build:

```sh
npm run frontend:preview
```

## API Overview

### Public and Auth

- `GET /api/health` - API health check.
- `POST /api/auth/google` - Login with a Google ID token.
- `GET /api/me` - Get the currently authenticated user.
- `POST /api/auth/logout` - Clear the current session.
- `POST /api/auth/logout-all` - Revoke all sessions for the authenticated account.

### Groups

- `GET /api/groups` - List groups for the current user.
- `POST /api/groups` - Create a group.
- `GET /api/groups/:id` - Get group details.
- `POST /api/groups/:id/invite` - An accepted administrator invites an existing user by email.
- `POST /api/groups/:groupId/join` - Accept a group invite.

### Expenses

- `POST /api/expenses` - Create an expense.
- `GET /api/expenses/:id` - Get one expense.
- `PUT /api/expenses/:id` - Update an expense.
- `DELETE /api/expenses/:id` - Delete an expense.

### Payments and Sync

- `POST /api/payments` - Record a settlement payment.
- `GET /api/sync` - Fetch all groups, members, expenses, payments, and user data for local sync.

Authenticated mutations require `X-SplitSync-Account` containing the user ID verified by `/api/me` or Google sign-in. A cookie for a different account returns `409 ACCOUNT_CHANGED` before any mutation. Authenticated responses expose `X-SplitSync-User` and use `Cache-Control: no-store`. Pending invitations contain group ID, name, creation time, role, and acceptance status; financial data requires accepted membership.

## Database Tables

The backend initializes the following PostgreSQL tables automatically:

- `users`
- `sessions`
- `groups`
- `group_members`
- `expenses`
- `expense_splits`
- `payments`

## Development Notes

- The frontend stores each account in `SplitExpensesDB:account:<encoded-user-id>`.
- Every `syncQueue` entry has an immutable `ownerId`; processing starts after server verification and stops on account changes or `401`.
- The backend uses a lightweight Prisma-like wrapper over `pg`; Prisma is not required.
- Inviting a member currently requires that the invited user has logged in at least once.
- The backend creates database tables at startup if they do not already exist.

## Account and Offline Security

Sessions use random opaque IDs with HMAC hashes stored in PostgreSQL. They expire after 30 days, or seven days without activity. Logout deletes the current session before confirming success; signing in replaces the previous browser session. `logout-all` revokes the account's other sessions.

Cached data may be restored offline for up to five days after the last server verification. Offline access is tied to that account and cannot submit mutations. Reconnecting verifies the cookie before processing changes. Login and logout propagate between tabs, invalidate old requests, and reset selected groups and dialogs.

Switching accounts preserves unsynced changes in the original account's storage; they resume only after that account signs in again. Explicit logout removes this device's account caches and queued changes. A failed server logout still clears local data and persists a lock; the UI reports that server revocation is unconfirmed and retries on reconnection. Reloading cannot bypass the lock.

Deploy the frontend and backend together. Existing signed cookies are invalidated by the session change. The legacy `SplitExpensesDB` has no reliable account owner, so the first updated startup removes that cache and its unowned queue with a visible explanation. Server records remain available after sign-in; older unsynced changes cannot be safely migrated.

Use separate hostnames, secrets, and cookie names for separate environments. Production can use `SESSION_COOKIE_NAME=__Host-SplitSync` with HTTPS to enforce host-only, root-path cookie protection. Cookies do not isolate applications by port.

## Security Regression Checks

```sh
npm run test:security
npm run test:browser
```

The tests use synthetic Google tokens, the installed Google verifier, an isolated PGlite PostgreSQL engine executing the real SQL adapter, and real Dexie storage. Browser tests use independent profiles and two tabs sharing a cookie jar. Windows uses installed Edge by default; on other hosts install Chromium with `npx playwright install chromium`. Set `SECURITY_BROWSER_CHANNEL` to select another installed browser channel.

The report's original command now runs the secure regression expectations, including browsers:

```sh
node --experimental-vm-modules docs/web-auth-audit-2026-11-19.mjs
```

See [the fix notes](docs/WEB_AUTH_SECURITY_FIXES_2026-11-19.md). The original findings and result JSON remain historical evidence. The `workbox-build` override keeps its build-time glob dependency on a patched version until upstream adopts it; validate the PWA build when changing this override.

## Future Improvements

- Email-based invitations for users who have not signed in yet.
- Stronger role-based authorization for admin-only actions.
- Receipt image uploads.
- Advanced filtering and export options.
- Conflict resolution for simultaneous offline edits.
- Production deployment templates.

## License

This project is currently marked as `ISC` in the root package metadata.
