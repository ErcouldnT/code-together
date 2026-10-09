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

Markdown typed into the document turns into what it means as soon as it is
unambiguous: `# ` starts a heading (up to `###### `), `> ` a quote, `- ` or
`1. ` a list, `[ ] ` (or `- [ ] `) a task, and a line of three backticks
followed by Enter a code block. One undo gives back the characters you typed.
A task is ticked by clicking its box, by anyone who can edit; the toolbar has
a button for task lists too, and both exports keep the ticks — `- [x]` in
Markdown, a checkbox in HTML.

Inline marks work the same way, closing as you type the last character:
`**bold**`, `*italic*` or `_italic_`, `` `code` ``, `~~struck~~`, and
`[words](https://…)` for a link. `---` alone on a line, then Enter, draws a
rule. Markdown *pasted* as plain text — a README out of a terminal, say —
arrives as the document it describes rather than as a page of asterisks;
a paste that already carries rich HTML, or one into a code block, is left as
it is.

Code blocks are coloured by [highlight.js](https://highlightjs.org). A block
nobody has chosen a language for guesses one, and its picker says what it
guessed — *Auto · Python*; picking another language from it fixes the choice
for everyone in the room, and ` ```js ` picks one as the block is opened. The
colours are drawn by each browser and never enter the document: Quill
highlights by formatting the text, and left alone y-quill would broadcast
every one of those formats to the room and store them with the text.

The button at the left of the title row opens the document's **contents**:
every heading, indented by level, with the one you are reading marked.
Choosing one scrolls to it. On a wide screen the outline is a column beside
the page that stays open until you close it (and this browser remembers);
on a tablet or a phone it is a drawer over the page that puts itself away
once you have picked a heading.

Everyone in a room gets a name and a colour, shown as a chip at the right of
the toolbar and on their cursor as it moves. There are no accounts — a room is
a URL — so the name lives in your own browser and you can change it by clicking
your own chip.

The **share** button beside the Document menu shows the document's address
as a QR code — point a phone's camera at it to open the same document there —
with a button to copy the link and, on a phone, the system share sheet. The
code is drawn in the browser, always black on white, from a library loaded only
when the button is pressed.

A document has a title, which is part of the document and syncs like the text.
The **Document** menu takes it away as HTML or Markdown, prints it (which is
also how you save a PDF), lists the rooms you have opened before, and opens the
version history.

**New document…** at the top of that menu makes a document with a name instead
of a random address: "Toplantı Notları" lives at `/toplanti-notlari` and starts
with that title. It can have a password, and the person making it chooses what
the password guards — *viewing*, so nobody without it sees anything, or
*editing*, so everyone can read and only the password holder can write. A
reader of an edit-protected document finds **Unlock editing…** in the same
menu. Without a password a document is what every document always was: anyone
with the address reads and writes. Passwords are stored as scrypt hashes; a
browser that knows one gets an HttpOnly cookie, so it is asked once.

A document can **delete itself**: in an hour, a day, a week or a month,
chosen when it is made or later from **Delete automatically…** in the
Document menu by anyone who may edit it. A countdown sits next to the title
for everyone in the room. When the time comes the server deletes the
document with its history and attachments, the people who have it open are
shown that it has gone, and their browsers drop the copy they kept. The
address then stays refused for thirty days — otherwise the first browser to
come back online with a local copy would sync the whole document straight
back into existence.

The interface speaks English, Turkish and Russian. The language is taken from
the browser's own preference list — the first of those three it finds there,
English otherwise — and can be changed at the bottom of the Document menu,
which this browser then remembers. Generated names follow suit: a Turkish
browser joins as "Sessiz Şahin", a Russian one as "Тихий Сокол".

## Administration

Set `ADMIN_TOKEN` and `/admin` becomes an admin screen; leave it unset and
the screen, and every route behind it, does not exist. Signing in with the
token sets an HttpOnly cookie that is an HMAC keyed by the token itself, so
changing the token signs everybody out.

The screen shows how the server is doing — documents, who has what open,
how much the pictures, attachments and database take up — and every limit
it enforces, in the units people think in:

- **rate limits**: HTTP requests per address per minute, password attempts,
  named documents made, and edits per connection per time window;
- **sizes and quotas**: the largest document, picture and attachment, the
  total attachments one document may hold, and the total for every stored
  file.

A change applies to the next request with no restart: each limit is read at
the moment it is enforced. Changed limits are kept in the database and
outrank the environment, which only says where each one starts; "Use
default" hands one back to the environment.

Under the status sits a list of **every document**, newest change first or
sorted by when it was made or by size, searchable by title or address and
narrowed to the ones open right now if you like. Each links to the document in
a new tab, with who is in it, whether it has a password and when it deletes
itself. Signed in, the admin opens every document, password or not: the
admin cookie is sent with every request to the site, and the access check
lets it through as it would the password's own. A visitor without it is
asked as before.

The screen also clears out documents nobody will come back to. **Empty**
ones — no text, title, attachment or password, at least an hour old — are
what a visit to the front page leaves behind when nobody types; **abandoned**
ones have not changed in 30, 90, 180 or 365 days. Each kind is counted and
listed before anything is deleted, deleting asks once more, and the server
finds the documents again itself rather than trusting a list from the page.
Both can also run every hour on their own. A document someone has open is
never touched. `DOCUMENT_TTL_DAYS` still turns on the hourly abandoned
cleanup, as it did before the screen existed.

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
  access.ts              named documents, passwords, and who may read or write
  expiry.ts              documents that delete themselves, and staying deleted
  admin.ts               the admin screen's API, behind ADMIN_TOKEN
  settings.ts            the limits as they stand, changeable without a restart
  storage.ts             how much the stored files take up, for the quotas
  cleanup.ts             finding and deleting empty and abandoned documents
  directory.ts           every document, a page at a time, for the admin screen
  admin-session.ts       the admin's cookie, which also opens every document
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
  src/i18n.ts            every word on the page, in English, Turkish and Russian
  src/markdown.ts        Markdown shortcuts typed into the text
  src/markdown-paste.ts  Markdown pasted as text, turned into the document
  src/syntax.ts          code highlighting, language guessing, and keeping it local
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
| `MAX_ATTACHMENT_BYTES` | no | `1073741824` | Largest file that can be attached to a document (1 GB). Streamed to disk, not held in memory. |
| `SNAPSHOT_EVERY_MS` | no | `600000` | How often a changing document earns a point in its history. |
| `SNAPSHOT_KEEP` | no | `20` | Points kept per document; older ones are dropped. |
| `ADMIN_TOKEN` | no | — | Password for `/admin`. Unset, the admin screen and its routes do not exist. |
| `REQUESTS_PER_MINUTE` | no | `300` | HTTP requests one address may make per minute. |
| `ATTACHMENT_QUOTA_BYTES` | no | `0` | Most one document's attachments may add up to. `0` is no limit. |
| `STORAGE_QUOTA_BYTES` | no | `0` | Most every stored file together may take, pictures and attachments both. `0` is no limit. |

The sizes and rate limits above are only where each one starts: anything changed on the
admin screen is kept in the database and outranks them.

Websockets need no extra configuration: Traefik upgrades them on the same host and path.
Because state lives in one SQLite file and in-process Socket.io rooms, run **one replica**.

## What else can be added

  * [x] Rate limit, request logging, update and document size caps
  * [x] Conflict-free concurrent editing, and reconnect that actually reconnects
  * [x] Live cursors and a presence bar
  * [x] Image upload, so a pasted screenshot is a link and not a megabyte of base64
  * [x] Document name input
  * [x] Version history and export (HTML, Markdown, print to PDF)
  * [x] Access control: named documents with a password on viewing or on editing
  * [x] Markdown shortcuts, task lists, and code blocks that guess their language
  * [x] A contents panel built from the headings
  * [x] Documents that delete themselves after a set time
  * [x] Share by QR code
  * [x] Admin screen: live rate limits, upload quotas, clearing out empty and abandoned documents
  * [ ] Video conference with webRTC

&copy; 2021 Ercode
