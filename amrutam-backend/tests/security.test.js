import { describe,it,expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('API abuse boundaries',()=>{
  it('rejects oversized JSON without exposing internals',async()=>{
    const response=await request(app).post('/api/v1/auth/login').send({payload:'x'.repeat(110000)});
    expect(response.status).toBe(413);
    expect(response.body.error).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
  it('throttles repeated authentication attempts with a consistent JSON error',async()=>{
    let response;
    for(let i=0;i<21;i++) response=await request(app).post('/api/v1/auth/login').send({});
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });
});
