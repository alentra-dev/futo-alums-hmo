import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/** Split a migration into top-level statements, as the deployment runner executes them. */
export function migrationStatements(sql: string) {
  return sql.replace(/--[^\n]*/g, '').match(/(?:\$\$[\s\S]*?\$\$|'(?:[^']|'')*'|[^;])+;/g) ?? [];
}

/**
 * Replays every migration into an embedded PostgreSQL with synthetic Supabase auth and
 * storage stubs. `auth.uid()` reads the `test.uid` setting. No production data is used.
 */
export async function migratedDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
  `);
  for (const file of readdirSync('supabase/migrations').sort()) {
    let sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    // This historical data repair asserts on production rows that a fresh database lacks.
    if (file.startsWith('202608250012')) sql = sql.replace(/if v_updated<>3 then raise exception[^;]*;\s*end if;/, '');
    for (const statement of migrationStatements(sql)) await db.exec(statement);
  }
  return db;
}

export const testId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
