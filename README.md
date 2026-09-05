# Code together!

An Express, Socket.io and React project to work together on a single webpage simultaneously.

## How it works?

Open the app and you are redirected to a freshly generated room id. Send that same URL
to your friends and everyone edits the same document in real time. Contents are saved
about every two seconds and survive redeploys.

The document is a [Yjs](https://yjs.dev) CRDT rather than a stream of Quill deltas, so
two people typing at the same position converge on the same text instead of drifting
apart, and a client that loses its connection keeps editing and merges on reconnect.
Yjs updates travel over the Socket.io connection the app already has — there is no
second endpoint and no separate websocket server to run.

Paste a screenshot, drag a photo in, or use the toolbar button: the picture is
uploaded and the document holds its address. Quill's own behaviour is to embed
pictures as base64 *inside* the text, which in a shared document means every
copy of that blob is broadcast to everyone in the room on every keystroke.

Everyone in a room gets a name and a colour, shown as a chip at the right of
the toolbar and on their cursor as it moves. There are no accounts — a room is
a URL — so the name lives in your own browser and you can change it by clicking
your own chip.

A document has a title, which is part of the document and syncs like the text.
The **Document** menu takes it away as HTML or Markdown, prints it (which is
also how you save a PDF), lists the rooms you have opened before, and opens the
version history.

## Stack

| Layer     | Technology |
| --------- | ---------- |
| Server    | Node 22, TypeScript, Express 5, Socket.io 4, Yjs 13 |
| Database  | SQLite via Drizzle ORM (`better-sqlite3`) |
| Client    | Vite 8, React 19, TypeScript, Quill 2, y-quill, React Router 7 |
| Delivery  | Docker (multi-stage), Docker Compose, Coolify |

The project is TypeScript end to end. `shared/events.ts` holds the Socket.io event
contract and is imported by both the server and the client, so a change to the wire
format fails the build on whichever side is out of date.

## Layout

```
src/                     Express + Socket.io server
  db/                    Drizzle schema and client
  documents.ts           load and save a room as a Yjs document
  export.ts              one delta, two file formats
  snapshots.ts           version history: periodic states, and restoring one
  uploads.ts             content-addressed picture store, and its sweeper
  rooms.ts               one in-memory Y.Doc per room, reference counted
  sockets.ts             the sync handshake, size and rate limits
shared/                  the wire contract, imported by both sides
drizzle/                 generated migrations — never hand-written
client/
  src/yjs/               binds the Y.Doc and awareness to the socket
  src/useQuill.ts        Quill + QuillBinding
  src/editor-images.ts   paste, drop and the toolbar button, via Quill's uploader
  src/identity.ts        your name and cursor colour, kept in this browser
  src/presence.ts        who else is here, read out of Yjs awareness
  src/components/        top bar, menu, history, presence, skeleton, notice
  src/recent.ts          rooms you have opened, kept in this browser only
tests/                   node:test, run against a real server over a real socket
```

## Local development

```bash
cp .env.example .env
npm install && npm --prefix client install
npm run db:generate      # only after changing src/db/schema.ts
npm run dev              # API + websockets on :5000
npm run client:dev       # Vite on :5173, proxies /socket.io to :5000
npm test                 # convergence, reconnect, persistence and limits
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

Documents live on the `together-data` volume at `/app/data/together.db`, and the
pictures in them at `/app/data/uploads`.

Version history is a full state written at most every `SNAPSHOT_EVERY_MS` while
a document is being edited, kept `SNAPSHOT_KEEP` deep, and deleted with the
document it belongs to. Restoring does not reset the document: the difference
between now and then is applied as an ordinary edit, so everyone else in the
room converges on it the same way they converge on any other change.

Uploads are typed by their bytes, never by the request's `Content-Type`, and SVG
is refused outright — the files are served from the same origin as the app, so
anything that can run script is stored XSS. An hourly sweep removes pictures no
document mentions and that are more than a day old; the delay is what stops it
deleting a picture between the upload finishing and the document being saved.

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
| `MAX_UPDATE_BYTES` | no | `1048576` | Largest single document update accepted. Mostly there to stop a pasted base64 image until real uploads exist. |
| `MAX_DOCUMENT_BYTES` | no | `8388608` | Largest a document may grow, checked against the size at the last save. |
| `UPDATE_BURST` / `UPDATE_WINDOW_MS` | no | `200` / `10000` | Per-socket update rate limit. |
| `UPLOAD_DIR` | no | `/app/data/uploads` | Pictures. Keep it under `/app/data` — same volume as the database, so one backup covers a document and its pictures. |
| `MAX_UPLOAD_BYTES` | no | `26214400` | Largest picture accepted. The browser shrinks anything big first; this is the backstop. |
| `SNAPSHOT_EVERY_MS` | no | `600000` | How often a changing document earns a point in its history. |
| `SNAPSHOT_KEEP` | no | `20` | Points kept per document; older ones are dropped. |

Websockets need no extra configuration: Traefik upgrades them on the same host and path.
Because state lives in one SQLite file and in-process Socket.io rooms, run **one replica**.

## What else can be added

  * [x] Rate limit, request logging, update and document size caps
  * [x] Conflict-free concurrent editing, and reconnect that actually reconnects
  * [x] Live cursors and a presence bar
  * [x] Image upload, so a pasted screenshot is a link and not a megabyte of base64
  * [x] Document name input
  * [x] Version history and export (HTML, Markdown, print to PDF)
  * [ ] Access control: today, anyone with the five-character address can edit
  * [ ] Video conference with webRTC

&copy; 2021 Ercode
