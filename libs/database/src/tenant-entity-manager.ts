import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { TenantDataSourceRegistry } from './tenant-datasource.registry';

/**
 * Thin wrapper over the current request's tenant DataSource.
 *
 * Inject this ONCE in any service instead of multiple @InjectRepository() calls.
 * All operations automatically route to the correct tenant schema.
 *
 * Usage:
 *   constructor(private db: TenantEntityManager) {}
 *
 *   async findUsers() {
 *     return this.db.repo(User).find();
 *   }
 *
 *   async inTransaction() {
 *     return this.db.transaction(async (em) => {
 *       await em.save(User, { ... });
 *     });
 *   }
 */
@Injectable()
export class TenantEntityManager {
  constructor(private readonly registry: TenantDataSourceRegistry) {}

  // ── Core accessors ────────────────────────────────────────────────────────

  get ds(): DataSource {
    return this.registry.current;
  }

  get manager(): EntityManager {
    return this.registry.current.manager;
  }

  // ── Repository shortcuts ──────────────────────────────────────────────────

  repo<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
    return this.registry.current.getRepository(entity);
  }

  qb<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    alias: string,
  ): SelectQueryBuilder<T> {
    return this.registry.current
      .getRepository(entity)
      .createQueryBuilder(alias);
  }

  // ── Convenience find wrappers (optional) ─────────────────────────────────

  find<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    options?: FindManyOptions<T>,
  ): Promise<T[]> {
    return this.repo(entity).find(options);
  }

  findOne<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    options: FindOneOptions<T>,
  ): Promise<T | null> {
    return this.repo(entity).findOne(options);
  }

  count<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    options?: FindManyOptions<T>,
  ): Promise<number> {
    return this.repo(entity).count(options);
  }

  save<T extends ObjectLiteral>(entity: EntityTarget<T>, data: T | T[]): Promise<T | T[]> {
    return this.repo(entity).save(data as any) as any;
  }

  // ── Transaction helper ────────────────────────────────────────────────────

  transaction<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.registry.current.transaction(fn);
  }
}
