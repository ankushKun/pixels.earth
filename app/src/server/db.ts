import { Database } from "bun:sqlite";

// Create DB in the project root or app root data directory
const dbKey = process.env.DB_PATH || "analytics.db";
const db = new Database(dbKey);

// Enable WAL mode
db.run('PRAGMA journal_mode = WAL');

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_pixels_placed INTEGER DEFAULT 0,
    total_shards_deployed INTEGER DEFAULT 0
  );
`);
db.run('INSERT OR IGNORE INTO global_stats (id) VALUES (1);');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    main_wallet TEXT PRIMARY KEY,
    session_address TEXT,
    pixels_placed_count INTEGER DEFAULT 0,
    shards_owned_count INTEGER DEFAULT 0
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS pixel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    px INTEGER,
    py INTEGER,
    color INTEGER,
    main_wallet TEXT,
    timestamp INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS shards (
    shard_x INTEGER,
    shard_y INTEGER,
    main_wallet TEXT,
    timestamp INTEGER,
    PRIMARY KEY (shard_x, shard_y)
  );
`);
  
db.run(`
  CREATE TABLE IF NOT EXISTS processed_sigs (
    signature TEXT PRIMARY KEY,
    processed_at INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS sync_state (
    label TEXT PRIMARY KEY,
    last_signature TEXT,
    updated_at INTEGER
  );
`);

// Optimize performance with Indices
db.run('CREATE INDEX IF NOT EXISTS idx_pixel_timestamp ON pixel_events(timestamp DESC);');
db.run('CREATE INDEX IF NOT EXISTS idx_pixel_coords ON pixel_events(px, py);');
db.run('CREATE INDEX IF NOT EXISTS idx_pixel_wallet ON pixel_events(main_wallet);');
db.run('CREATE INDEX IF NOT EXISTS idx_shard_timestamp ON shards(timestamp DESC);');

export default db;
