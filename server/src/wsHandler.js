import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import {
  pubClient,
  subClient,
  getHotRoomState,
  setHotRoomState,
} from './redis.js';
import { loadDocumentFromDB, saveDocumentToDB } from './db.js';

const INSTANCE_ID = uuidv4();
const FLUSH_INTERVAL_MS = 3000;

// Map<roomId, { doc: Y.Doc, clients: Set<WebSocket>, flushTimer: NodeJS.Timeout | null, dirty: boolean }>
const rooms = new Map();

export async function initPubSub() {
  await subClient.pSubscribe('room:updates:*', (rawMessage, channel) => {
    const roomId = channel.replace('room:updates:', '');
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = JSON.parse(rawMessage);

    // Apply CRDT update if it originated from a different Node replica
    if (msg.instanceId !== INSTANCE_ID) {
      const updateUint8 = new Uint8Array(Buffer.from(msg.update, 'base64'));
      Y.applyUpdate(room.doc, updateUint8, 'redis');
    }

    // Fan out to locally connected WebSocket clients (excluding the original sender)
    const outbound = JSON.stringify({
      type: 'sync_update',
      update: msg.update,
      sentAt: msg.sentAt,
    });

    for (const client of room.clients) {
      if (client.readyState === 1 && client.clientId !== msg.senderId) {
        client.send(outbound);
      }
    }
  });
}

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);

  const doc = new Y.Doc();

  // Hydrate from hot Redis cache first; fallback to PostgreSQL
  let initialState = await getHotRoomState(roomId);
  if (!initialState) {
    initialState = await loadDocumentFromDB(roomId);
    if (initialState) {
      await setHotRoomState(roomId, initialState);
    }
  }

  if (initialState) {
    Y.applyUpdate(doc, initialState, 'hydration');
  }

  const room = {
    doc,
    clients: new Set(),
    flushTimer: null,
    dirty: false,
  };

  rooms.set(roomId, room);
  return room;
}

function schedulePostgresFlush(roomId, room) {
  room.dirty = true;
  if (room.flushTimer) return;

  room.flushTimer = setTimeout(async () => {
    room.flushTimer = null;
    if (!room.dirty) return;

    try {
      const fullState = Y.encodeStateAsUpdate(room.doc);
      const textPreview = room.doc.getText('content').toString();
      await saveDocumentToDB(roomId, fullState, textPreview);
      room.dirty = false;
    } catch (err) {
      console.error(`Failed flushing room ${roomId} to Postgres:`, err);
    }
  }, FLUSH_INTERVAL_MS);
}

export async function handleConnection(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('roomId') || 'default-room';
  ws.clientId = uuidv4();
  ws.roomId = roomId;
  ws.isAlive = true;

  const room = await getOrCreateRoom(roomId);
  room.clients.add(ws);

  // Send initial full CRDT snapshot to the joining client
  const stateVector = Y.encodeStateAsUpdate(room.doc);
  ws.send(
    JSON.stringify({
      type: 'init_state',
      clientId: ws.clientId,
      instanceId: INSTANCE_ID,
      state: Buffer.from(stateVector).toString('base64'),
    })
  );

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'update' && data.update) {
        const updateUint8 = new Uint8Array(Buffer.from(data.update, 'base64'));

        // Merge update deterministically into local Y.Doc
        Y.applyUpdate(room.doc, updateUint8, ws.clientId);

        // Save merged state to Redis hot cache & broadcast via Pub Sub
        const mergedState = Y.encodeStateAsUpdate(room.doc);
        await setHotRoomState(roomId, mergedState);

        await pubClient.publish(
          `room:updates:${roomId}`,
          JSON.stringify({
            instanceId: INSTANCE_ID,
            senderId: ws.clientId,
            update: data.update,
            sentAt: data.sentAt || Date.now(),
          })
        );

        // Schedule debounced Postgres persistence
        schedulePostgresFlush(roomId, room);
      }
    } catch (err) {
      console.error('WS Message Error:', err);
    }
  });

  ws.on('close', async () => {
    room.clients.delete(ws);

    // Immediately flush to Postgres and release memory when room becomes empty
    if (room.clients.size === 0) {
      if (room.flushTimer) clearTimeout(room.flushTimer);
      if (room.dirty) {
        const fullState = Y.encodeStateAsUpdate(room.doc);
        const textPreview = room.doc.getText('content').toString();
        await saveDocumentToDB(roomId, fullState, textPreview);
      }
      rooms.delete(roomId);
    }
  });
}