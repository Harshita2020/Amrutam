import { httpError } from '../utils/http-error.js';

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(httpError(401, 'UNAUTHENTICATED', 'Authentication is required'));
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return next(httpError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    }
    return next();
  };
}
