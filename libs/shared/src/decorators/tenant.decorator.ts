import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../types/common.types';

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user?.tenantId;
  },
);
