import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = createClient({ url: redisUrl });
export const pubClient = redisClient.duplicate();
export const subClient = redisClient.duplicate();

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
pubClient.on('error', (err) => console.error('Redis Pub Error:', err));
subClient.on('error', (err) => console.error('Redis Sub Error:', err));

export async function initRedis() {
  await Promise.all([
    redisClient.connect(),
    pubClient.connect(),
    subClient.connect(),
  ]);
}

export async function setHotRoomState(roomId, stateUint8) {
  const b64 = Buffer.from(stateUint8).toString('base64');
  await redisClient.set(`room:state:${roomId}`, b64, { EX: 3600 });
}

export async function getHotRoomState(roomId) {
  const b64 = await redisClient.get(`room:state:${roomId}`);
  if (!b64) return null;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}