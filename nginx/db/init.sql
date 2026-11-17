CREATE TABLE IF NOT EXISTS documents (
    room_id VARCHAR(64) PRIMARY KEY,
    yjs_state BYTEA NOT NULL,
    text_preview TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);