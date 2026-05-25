import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// Prisma error codes reference: https://www.prisma.io/docs/reference/api-reference/error-reference
const PRISMA_ERROR_MAP: Readonly<Record<string, { status: number; message: string }>> = {
  P2000: { status: 400, message: 'Input value too long' },
  P2001: { status: 404, message: 'Record not found' },
  P2002: { status: 409, message: 'A record with this value already exists' },
  P2003: { status: 400, message: 'Related record not found' },
  P2004: { status: 400, message: 'Constraint failed on the database' },
  P2025: { status: 404, message: 'Record to update or delete was not found' },
};

function isPrismaError(err: unknown): err is { code: string; meta?: Record<string, unknown>; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    !!((err as Record<string, unknown>).code as string | undefined)?.startsWith('P')
  );
}

function isThrottlerError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as Record<string, unknown>).constructor?.name === 'ThrottlerException'
  );
}

const isProd = process.env.NODE_ENV === 'production';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const requestId = request.requestId ?? request.headers['x-request-id'] ?? 'unknown';
    const path = request.url;
    const method = request.method;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] = [];

    // HttpException (includes NestJS validation, auth, guards)
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        if (Array.isArray(b.message)) {
          errors = b.message as string[];
          message = 'Validation failed';
        } else if (typeof b.message === 'string') {
          message = b.message;
        }
      }
      this.logger.warn(`[${requestId}] HTTP ${statusCode} ${method} ${path}: ${message}`);

    // Prisma known errors
    } else if (isPrismaError(exception)) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      statusCode = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      message = mapped?.message ?? 'Database error';

      this.logger.error(
        `[${requestId}] Prisma ${exception.code} on ${method} ${path}: ${isProd ? message : exception.message}`,
        isProd ? undefined : String((exception as unknown as { stack?: string }).stack ?? ''),
      );

    // Unknown/unhandled errors — never leak internals in production
    } else {
      const err = exception as Error;
      this.logger.error(
        `[${requestId}] Unhandled exception on ${method} ${path}: ${err?.message ?? String(exception)}`,
        isProd ? undefined : err?.stack,
      );
      message = isProd ? 'Internal server error' : (err?.message ?? 'Unknown error');
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      ...(errors.length > 0 && { errors }),
      path,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
