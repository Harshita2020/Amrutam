export function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested route was not found'
    }
  });
}
