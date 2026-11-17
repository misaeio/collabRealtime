# Collaborative Document Engine

A WebSocket backend that lets multiple people edit the same text document at the same time across different server instances without losing changes.

## How It Works

```
Clients (WebSocket)
       │
       ▼
  Nginx (least_conn)
   ├── Node.js Server 1 ──┐
   ├── Node.js Server 2 ──┼──► Redis (Active State + Pub/Sub)
   └── Node.js Server 3 ──┘           │
                                      ▼
                                 PostgreSQL (Saved Snapshots)
```

* **Nginx:** Splits incoming WebSocket connections across 3 Node.js servers so no single server gets overloaded.
* **Node.js + Yjs:** Merges overlapping edits in memory using Yjs so concurrent typing never overwrites someone else's work.
* **Redis:** Holds the current room state for fast loading and passes new edits between all 3 Node.js servers using Pub/Sub.
* **PostgreSQL:** Saves a snapshot of the document every 3 seconds while people are typing, and saves one final copy when everyone leaves the room.

## Tech Stack

* **Backend:** Node.js, `ws`
* **Sync Engine:** Yjs
* **Cache & Messaging:** Redis
* **Database:** PostgreSQL
* **Load Balancer:** Nginx
* **Containers & Testing:** Docker Compose, k6

## Project Structure

```text
├── db/
│   └── init.sql            # Creates the documents table in PostgreSQL
├── loadTest/
│   └── ws-test.js          # k6 script that simulates 500 concurrent users
├── nginx/
│   └── nginx.conf          # Routes WebSocket traffic to the Node servers
├── server/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js        # Starts the HTTP and WebSocket server
│       ├── wsHandler.js    # Handles rooms, Yjs updates, Redis, and DB saves
│       ├── redis.js        # Connects to Redis for caching and Pub/Sub
│       └── db.js           # Reads and writes document snapshots to Postgres
└── docker-compose.yml      # Spins up Nginx, 3 Node servers, Redis, and Postgres
```

## Running It Locally

1. **Start everything with Docker:**
   ```bash
   docker compose up -d --build
   ```

2. **Check that all 6 containers are up:**
   ```bash
   docker compose ps
   ```

3. **Connect a client:**
   Open a WebSocket connection to `ws://localhost:80/?roomId=test`.
   * When you join, the server sends back `{ "type": "init_state", "state": "<base64>" }`.
   * To push an edit, send `{ "type": "update", "update": "<base64_yjs_update>" }`.

## Load Testing (k6)

I ran a 60 second load test with 500 virtual users spread across 25 rooms to see how the setup holds up under traffic:

```bash
docker run --rm -i --network collabrealtime_default -v "\${PWD}:/scripts" grafana/k6 run /scripts/loadTest/ws-test.js
```

| Metric | Result |
| :--- | :--- |
| Concurrent Users | 500 |
| Successful Connections | 100% (1,009 / 1,009) |
| Median Connection Time | 1.93 ms (p95: 12.76 ms) |
| Updates Sent by Clients | 40,130 (~529/sec) |
| Updates Broadcast to Rooms | 527,290 (~6,953/sec) |
| Server to Server Sync Delay | 4 ms median / 7.02 ms avg / 20 ms p95 |
| Total Saved Size (25 Rooms) | 525 bytes in PostgreSQL |
