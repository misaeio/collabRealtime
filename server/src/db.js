import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

export async function loadDocumentFromDB(roomId) {
  const res = await pool.query(
    'SELECT yjs_state FROM documents WHERE room_id = $1',
    [roomId]
  );
  if (res.rows.length === 0) return null;
  return new Uint8Array(res.rows[0].yjs_state);
}

export async function saveDocumentToDB(roomId, yjsStateUint8, textPreview) {
  const buffer = Buffer.from(yjsStateUint8);
  await pool.query(
    `INSERT INTO documents (room_id, yjs_state, text_preview, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET
       yjs_state = EXCLUDED.yjs_state,
       text_preview = EXCLUDED.text_preview,
       updated_at = NOW()`,
    [roomId, buffer, textPreview]
  );
}