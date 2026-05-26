import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://paperclip:paperclip_dev@localhost:5434/paperclip',
  max: 10,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
