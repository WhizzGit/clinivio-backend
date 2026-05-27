import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

/**
 * Manages one TypeORM DataSource per tenant (schema-per-tenant on a single Neon DB).
 *
 * Each tenant gets its own PostgreSQL schema: `tenant_{slug}`.
 * TypeORM's `schema` option sets the `search_path` for all queries automatically.
 *
 * Uses Node.js AsyncLocalStorage to propagate the current tenant's DataSource
 * through the entire request chain without any REQUEST-scoped injection.
 */
@Injectable()
export class TenantDataSourceRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(TenantDataSourceRegistry.name);
  private readonly cache = new Map<string, DataSource>();

  /** ALS store: the active tenant DataSource for the current async context */
  readonly als = new AsyncLocalStorage<DataSource>();

  constructor(private readonly config: ConfigService) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Wraps the request handler chain in the tenant's DataSource ALS context.
   * Called by TenantContextMiddleware for every incoming request.
   */
  async runWithTenant(
    tenantId: string,
    slug: string,
    fn: () => void,
  ): Promise<void> {
    const ds = await this.getOrCreate(tenantId, slug);
    this.als.run(ds, fn);
  }

  /**
   * Returns the DataSource for the current async context (i.e. current request).
   * Throws if no tenant context has been established.
   */
  get current(): DataSource {
    const ds = this.als.getStore();
    if (!ds) {
      throw new Error(
        'TenantDataSourceRegistry: no tenant context. ' +
        'Ensure TenantContextMiddleware is applied and the route carries a tenant slug.',
      );
    }
    return ds;
  }

  /**
   * Returns null instead of throwing — useful for platform-level (super-admin) code
   * that may legitimately run without a tenant context.
   */
  get currentOrNull(): DataSource | null {
    return this.als.getStore() ?? null;
  }

  /**
   * Lazily creates (or returns from cache) a DataSource for the given tenant schema.
   * Also used during tenant provisioning to pre-warm the connection.
   */
  async getOrCreate(tenantId: string, slug: string): Promise<DataSource> {
    const cached = this.cache.get(tenantId);
    if (cached?.isInitialized) return cached;

    this.logger.log(`Initializing DataSource for tenant '${slug}' (schema: tenant_${slug})`);

    const ds = new DataSource(this.buildOptions(slug));
    await ds.initialize();

    this.cache.set(tenantId, ds);
    this.logger.log(`DataSource ready for tenant '${slug}'`);
    return ds;
  }

  /**
   * Returns all currently-initialized tenant DataSources.
   * Used by cross-tenant services (e.g. WhatsApp webhook handler) that need to
   * search across tenants without an incoming request context.
   */
  getAll(): DataSource[] {
    return [...this.cache.values()].filter((ds) => ds.isInitialized);
  }

  /**
   * Destroys and removes a cached DataSource — call when a tenant is deactivated.
   */
  async evict(tenantId: string): Promise<void> {
    const ds = this.cache.get(tenantId);
    if (ds?.isInitialized) await ds.destroy().catch(() => {});
    this.cache.delete(tenantId);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const [id, ds] of this.cache) {
      if (ds.isInitialized) {
        this.logger.log(`Closing DataSource for tenant ${id}`);
        await ds.destroy().catch(() => {});
      }
    }
    this.cache.clear();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildOptions(slug: string): DataSourceOptions {
    const url =
      this.config.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');

    const isProd = process.env.NODE_ENV === 'production';

    return {
      type: 'postgres',
      url,
      // All entities live in this tenant's schema — TypeORM sets search_path automatically
      schema: `tenant_${slug}`,
      entities: ALL_ENTITIES,
      // Auto-sync creates/alters tables in the tenant schema.
      // For production use TypeORM migrations instead.
      synchronize: !isProd,
      ssl: isProd ? { rejectUnauthorized: false } : false,
      logging: process.env.LOG_QUERIES === 'true' ? ['query', 'error'] : ['error'],
      extra: {
        // Keep per-tenant pools small (many tenants × pool size = DB connections)
        max: 3,
        min: 0,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 60_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      },
    };
  }
}
