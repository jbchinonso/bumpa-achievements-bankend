import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Catches everything (not just HttpExceptions) so an unexpected error
// never leaks a raw stack trace to the client — it always gets a
// consistent JSON body and a 500 instead of crashing the response.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    const body = isHttpException
      ? this.normalize(exception.getResponse())
      : { message: 'Internal server error' };

    response.status(status).json({
      ...body,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private normalize(errorResponse: string | object): Record<string, unknown> {
    return typeof errorResponse === 'string'
      ? { message: errorResponse }
      : (errorResponse as Record<string, unknown>);
  }
}
