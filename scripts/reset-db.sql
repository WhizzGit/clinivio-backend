-- ─── Reset Database (run in Neon SQL editor or via psql) ─────────────────────
-- WARNING: This drops ALL tables and custom types in the public schema.
-- Use this when migrating from Prisma to TypeORM to start fresh.
--
-- After running this script, restart the API (TypeORM will recreate all tables),
-- then run: pnpm db:seed

-- Drop all tables in the public schema (CASCADE handles FK dependencies)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
        RAISE NOTICE 'Dropped table: %', r.tablename;
    END LOOP;
END $$;

-- Drop all custom enum types (TypeORM will recreate them)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typtype = 'e'
          AND n.nspname = 'public'
    ) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE';
        RAISE NOTICE 'Dropped type: %', r.typname;
    END LOOP;
END $$;

SELECT 'Database reset complete. Restart the API to let TypeORM recreate the schema.' AS status;
