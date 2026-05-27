import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request, Response, NextFunction } from 'express';
import { TenantDataSourceRegistry, Tenant } from '@mediflow/database';

/**
 * TenantContextMiddleware
 *
 * Runs on every request. Extracts the tenant slug from:
 *  1. The subdomain: `hansvl.clinivio.ai` → slug = "hansvl"
 *  2. The `X-Tenant-Slug` header (useful for local development on localhost)
 *
 * If a matching active tenant is found, wraps the rest of the request
 * chain inside the tenant's DataSource AsyncLocalStorage context, so
 * TenantEntityManager automatically routes to tenant_<slug> schema.
 *
 * Super-admin routes (no subdomain / slug) skip tenant context entirely.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(
    private readonly registry: TenantDataSourceRegistry,
    @InjectDataSource() private readonly platformDs: DataSource,
  ) {}

  async use(req: Request & { tenantSlug?: string }, res: Response, next: NextFunction) {
    const slug = this.extractSlug(req);

    if (!slug) {
      // No tenant context (platform / super-admin request)
      return next();
    }

    try {
      const tenant = await this.platformDs
        .getRepository(Tenant)
        .findOne({ where: { slug, isActive: true } });

      if (!tenant) {
        this.logger.warn(`Unknown or inactive tenant slug: "${slug}"`);
        return next();
      }

      // Attach slug to request for logging / debugging
      req.tenantSlug = slug;

      await this.registry.runWithTenant(tenant.id, tenant.slug, () => next());
    } catch (err) {
      this.logger.error(`TenantContextMiddleware error for slug "${slug}": ${(err as Error).message}`);
      next();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private extractSlug(req: Request): string | null {
    // 1. X-Tenant-Slug header (dev / API clients that can't use subdomains)
    const header = req.headers['x-tenant-slug'];
    if (typeof header === 'string' && header.trim()) {
      return header.trim().toLowerCase();
    }

    // 2. Subdomain: host = "hansvl.clinivio.ai"  →  slug = "hansvl"
    const host = req.hostname ?? '';  // hostname strips port
    const parts = host.split('.');

    // Need at least: slug + domain + tld  (3 parts)
    // Skip "www", "admin", "api" — those are platform subdomains, not tenants
    const PLATFORM_SUBDOMAINS = new Set(['www', 'admin', 'api', 'app', 'localhost']);
    if (parts.length >= 3 && !PLATFORM_SUBDOMAINS.has(parts[0])) {
      return parts[0].toLowerCase();
    }

    return null;
  }
}
