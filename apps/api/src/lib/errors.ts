/**
 * An error whose message is safe to show to the client. The global error handler
 * sends `message` for 4xx status codes; anything else becomes a generic 500.
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
