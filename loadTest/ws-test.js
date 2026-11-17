import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const broadcastLatency = new Trend('ws_broadcast_latency_ms');
const messagesReceived = new Counter('ws_messages_received');

export const options = {
  stages: [
    { duration: '15s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    ws_broadcast_latency_ms: ['p(95)<100'],
    checks: ['rate>0.99'],
  },
};

const SAMPLE_YJS_UPDATE_B64 = 'AQGP7r+QDgAEAQdjb250ZW50AWEA';

export default function () {
  const roomId = `bench-room-${__VU % 25}`;
  const url = `ws://nginx:80/?roomId=${roomId}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      socket.setInterval(() => {
        socket.send(
          JSON.stringify({
            type: 'update',
            update: SAMPLE_YJS_UPDATE_B64,
            sentAt: Date.now(),
          })
        );
      }, 500);
    });

    socket.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'sync_update' && msg.sentAt) {
        broadcastLatency.add(Date.now() - msg.sentAt);
        messagesReceived.add(1);
      }
    });

    socket.setTimeout(() => {
      socket.close();
    }, 20000);
  });

  check(res, { 'WebSocket handshake succeeded (101)': (r) => r && r.status === 101 });
  sleep(1);
}
