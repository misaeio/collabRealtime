import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { initRedis } from './redis.js';
import { initPubSub, handleConnection } from './wsHandler.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', handleConnection);

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

async function bootstrap() {
  await initRedis();
  await initPubSub();

  server.listen(PORT, () => {
    console.log(`Collab WS node listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});