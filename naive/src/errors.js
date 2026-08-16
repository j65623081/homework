/**
 * Единый тип ошибки приложения.
 * Всё, что бросается намеренно, — это ApiError; всё остальное считается 500.
 */
export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, 'bad_request', message, details);

export const validationFailed = (details) =>
  new ApiError(422, 'validation_failed', 'Request body failed validation', details);

export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'not_found', message);

export const methodNotAllowed = (allowed) =>
  new ApiError(405, 'method_not_allowed', `Method not allowed. Allowed: ${allowed.join(', ')}`);

export const unsupportedMediaType = () =>
  new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');

export const payloadTooLarge = (limit) =>
  new ApiError(413, 'payload_too_large', `Request body must not exceed ${limit} bytes`);
