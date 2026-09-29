/**
 * An error whose message is written for users and safe to show at any status code
 * (e.g. 503 "GitHub rate limit reached"). Any other error that reaches the global
 * handler becomes a generic 500 and is logged.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
