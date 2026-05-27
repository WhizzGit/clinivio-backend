/**
 * TypeORM DataSource — used by the typeorm CLI for migrations.
 *
 *   pnpm typeorm migration:generate src/migrations/AddFoo -d apps/api/src/config/datasource.ts
 *   pnpm typeorm migration:run -d apps/api/src/config/datasource.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@mediflow/database';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const isProduction = process.env.NODE_ENV === 'production';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ALL_ENTITIES,
  migrations: ['apps/api/src/migrations/*.ts'],
  synchronize: false,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  extra: {
    max: 5,
    min: 1,
    idleTimeoutMillis: 30000,
  },
});
