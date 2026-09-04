# Code together!

An Express, Socket.io and React project to work together on a single webpage simultaneously.

## How it works?

Open the app and you are redirected to a freshly generated room id. Send that same URL
to your friends and everyone edits the same document in real time. Contents are saved
every two seconds and survive redeploys.

## Stack

| Layer     | Technology |
| --------- | ---------- |
| Server    | Node 22, TypeScript, Express 5, Socket.io 4 |
| Database  | SQLite via Drizzle ORM (`better-sqlite3`) |
| Client    | Vite 8, React 19, TypeScript, Quill 2, React Router 7 |
| Delivery  | Docker (multi-stage), Docker Compose, Coolify |

The project is TypeScript end to end. `shared/events.ts` holds the Socket.io event
contract and is imported by both the server and the client, so a change to the wire
format fails the build on whichever side is out of date.

## Layout

```
src/            Express + Socket.io server
  db/           Drizzle schema and client
  documents.ts  document repository
shared/         socket event types shared with the client (types only)
drizzle/        generated migrations — never hand-written
client/         Vite + React single page app
```

## Local development

```bash
cp .env.example .env
npm install && npm --prefix client install
npm run db:generate      # only after changing src/db/schema.ts
npm run dev              # API + websockets on :5000
npm run client:dev       # Vite on :5173, proxies /socket.io to :5000
```

Migrations are applied at boot by the server; never run raw SQL against the database
by hand. To change the schema, edit `src/db/schema.ts` and run `npm run db:generate`.

## Docker

```bash
docker compose up -d --build
```

The compose file deliberately publishes **no host ports**. The container only exposes
5000 on the Docker network, which is how a reverse proxy (Coolify's Traefik) reaches it.
To poke at it locally, use `docker compose exec` or attach a container to the network.

Documents live on the `together-data` volume at `/app/data/together.db`.

## Deploying with Coolify

1. **New Resource → Docker Compose** (or *Private/Public Repository* with build pack
   *Docker Compose*), pointing at this repository, compose file `compose.yaml`.
2. Set the environment variables below.
3. Coolify reads `SERVICE_FQDN_APP_5000`, generates the domain and writes the Traefik
   labels itself — do not add a `ports:` mapping, it is not needed and would expose the
   app directly on the host.
4. Deploy. The healthcheck hits `/healthz`; the container is only routed once healthy.

### Environment variables

| Variable | Required | Default | Notes |
| -------- | -------- | ------- | ----- |
| `SERVICE_FQDN_APP_5000` | yes | — | Coolify magic variable. Leave the value empty for a generated domain, or set it to your own hostname (e.g. `together.erkuttekoglu.com`). |
| `NODE_ENV` | no | `production` | |
| `PORT` | no | `5000` | Must match the port in `SERVICE_FQDN_APP_5000` and in `expose`. |
| `DATABASE_PATH` | no | `/app/data/together.db` | Keep it under `/app/data`, that is the volume. |
| `DOCUMENT_TTL_DAYS` | no | `0` | Prune rooms untouched for N days. `0` keeps everything. |

Websockets need no extra configuration: Traefik upgrades them on the same host and path.
Because state lives in one SQLite file and in-process Socket.io rooms, run **one replica**.

## What else can be added

  * [ ] Document name input
  * [ ] Video conference with webRTC
  * [ ] Morgan & Rate limit & Slow down
  * [ ] Share mouse-events with each player
  * [ ] Make the editor like CodeWars, HackerRank ide

&copy; 2021 Ercode
