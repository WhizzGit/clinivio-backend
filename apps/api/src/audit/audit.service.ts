import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { AuditLog } from "@mediflow/database";

export interface AuditEntry {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  description?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  success?: boolean;
}

@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private platformDs: DataSource) {}

  /** Fire-and-forget — never throws, never blocks the main request. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.platformDs.getRepository(AuditLog).save({
        ...entry,
        success: entry.success ?? true,
      });
    } catch (err: any) {
      console.error("[Audit] write failed:", err?.message);
    }
  }

  async findAll(
    tenantId: string,
    filters: {
      action?: string;
      entityType?: string;
      userId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      page = 1,
      limit = 50,
      action,
      entityType,
      userId,
      from,
      to,
    } = filters;
    const safeLimit = Math.min(limit, 100);

    const qb = this.platformDs
      .getRepository(AuditLog)
      .createQueryBuilder("log")
      .where("log.tenantId = :tenantId", { tenantId })
      .orderBy("log.createdAt", "DESC")
      .skip((page - 1) * safeLimit)
      .take(safeLimit);

    if (action) qb.andWhere("log.action = :action", { action });
    if (entityType) qb.andWhere("log.entityType = :entityType", { entityType });
    if (userId) qb.andWhere("log.userId = :userId", { userId });
    if (from) qb.andWhere("log.createdAt >= :from", { from: new Date(from) });
    if (to) qb.andWhere("log.createdAt <= :to", { to: new Date(to) });

    const [data, total] = await qb.getManyAndCount();
    return {
      data,
      total,
      page,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
    };
  }
}
