export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = error.type === 'entity.parse.failed'
    ? 400
    : error.type === 'entity.too.large' ? 413
    : Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) {
    // Do not expose stack traces or internal error details to API clients.
    console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId: req.requestId,
      method: req.method, route: req.route?.path ?? 'unmatched', errorName: error.name }));
  }

  res.status(status).json({
    error: {
      code: status === 500
        ? 'INTERNAL_SERVER_ERROR'
        : error.type === 'entity.parse.failed' ? 'VALIDATION_ERROR' : error.code ?? 'REQUEST_ERROR',
      message: status === 500
        ? 'An unexpected error occurred'
        : status === 400 && error.type === 'entity.parse.failed'
          ? 'Request body must contain valid JSON'
          : error.message
    }
  });
}
