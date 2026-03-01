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
- Logout support with local cache cleanup.

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
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
├── Frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── db.js
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
FRONTEND_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
PORT=3000

# Frontend
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_API_URL=http://localhost:3000
```

For local development, `COOKIE_SECURE=false` is expected because the app normally runs on plain HTTP. Use `COOKIE_SECURE=true` only when serving over HTTPS.

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

Build and run the full stack:

```sh
docker compose up --build
```

If your Docker installation uses the legacy Compose command:

```sh
docker-compose up --build
```

Docker service URLs from the current Compose file:

- Frontend: `http://localhost:5003`
- Backend API: `http://localhost:3003`
- PostgreSQL host port: `localhost:5435`

Stop the stack:

```sh
docker compose down
```

Stop the stack and remove the database volume:

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

### Groups

- `GET /api/groups` - List groups for the current user.
- `POST /api/groups` - Create a group.
- `GET /api/groups/:id` - Get group details.
- `POST /api/groups/:id/invite` - Invite an existing user by email.
- `POST /api/groups/:groupId/join` - Accept a group invite.

### Expenses

- `POST /api/expenses` - Create an expense.
- `GET /api/expenses/:id` - Get one expense.
- `PUT /api/expenses/:id` - Update an expense.
- `DELETE /api/expenses/:id` - Delete an expense.

### Payments and Sync

- `POST /api/payments` - Record a settlement payment.
- `GET /api/sync` - Fetch all groups, members, expenses, payments, and user data for local sync.

## Database Tables

The backend initializes the following PostgreSQL tables automatically:

- `users`
- `groups`
- `group_members`
- `expenses`
- `expense_splits`
- `payments`

## Development Notes

- The frontend stores local app data in IndexedDB database `SplitExpensesDB`.
- The sync queue is stored in the `syncQueue` table in IndexedDB.
- The backend uses a lightweight Prisma-like wrapper over `pg`; Prisma is not required.
- Inviting a member currently requires that the invited user has logged in at least once.
- The backend creates database tables at startup if they do not already exist.

## Future Improvements

- Email-based invitations for users who have not signed in yet.
- Stronger role-based authorization for admin-only actions.
- Receipt image uploads.
- Advanced filtering and export options.
- Conflict resolution for simultaneous offline edits.
- Automated tests for frontend workflows and backend routes.
- Production deployment templates.

## License

This project is currently marked as `ISC` in the root package metadata.
