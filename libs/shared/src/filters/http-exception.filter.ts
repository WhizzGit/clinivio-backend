import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  success: boolean;
  statusCode: number;
  message: string;
  errors: string[];
  path: string;
  timestamp: string;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception.getResponse();

    let message = 'An unexpected error occurred';
    let errors: string[] = [];

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      const responseObj = exceptionResponse as Record<string, unknown>;

      if (typeof responseObj['message'] === 'string') {
        message = responseObj['message'];
      } else if (Array.isArray(responseObj['message'])) {
        errors = responseObj['message'] as string[];
        message = 'Validation failed';
      }

      if (Array.isArray(responseObj['errors'])) {
        errors = responseObj['errors'] as string[];
      }
    }

    const errorBody: ErrorResponseBody = {
      success: false,
      statusCode: status,
      message,
      errors,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    this.logger.warn(
      `HTTP ${status} on ${request.method} ${request.url}: ${message}`,
    );

    response.status(status).json(errorBody);
  }
}
