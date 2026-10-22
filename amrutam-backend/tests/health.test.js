import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('returns service health without requiring a database connection', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'amrutam-backend' });
  });
});

describe('unknown routes', () => {
  it('returns a consistent 404 response', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('OpenAPI document', () => {
  it('serves the checked-in API schema', async () => {
    const response = await request(app).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths['/consultations/{id}/prescriptions'].post).toBeDefined();
  });
});
