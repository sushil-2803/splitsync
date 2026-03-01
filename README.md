# SplitSync

SplitSync is split into two independent workspaces:

- `Backend`: Express API on Node.js with PostgreSQL and Google ID token auth.
- `Frontend`: React + Vite client with Google Sign-In and a Vite `/api` proxy.

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```

2. Configure environment values from `.env.example`.

3. Start PostgreSQL and make sure `Backend/.env` has a valid `DATABASE_URL`.

## Commands

Run the backend only:
```sh
npm run backend:dev
```

Run the frontend only:
```sh
npm run frontend:dev
```

Build each side independently:
```sh
npm run backend:build
npm run frontend:build
```

## Docker

Build and run the full stack:
```sh
docker compose up --build
```

If your Docker install uses the legacy Compose binary:
```sh
docker-compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

Stop the stack:
```sh
docker compose down
```
