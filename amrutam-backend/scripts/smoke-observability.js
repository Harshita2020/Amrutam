import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

let exportsReceived = 0;
const collector = createServer((req,res) => {
  req.resume();
  req.on('end', () => { if (req.url === '/v1/traces') exportsReceived++; res.setHeader('Content-Type','application/json');res.end('{}'); });
});
await new Promise(resolve => collector.listen(0,'127.0.0.1',resolve));
try {
  const source = `
    const {default:app}=await import('./src/app.js');
    const {pool}=await import('./src/config/db.js');
    const {shutdownTracing}=await import('./src/observability/tracing.js');
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    try {
      for(const path of ['/api/v1/health','/api/v1/openapi.json']) {
        const r=await fetch('http://127.0.0.1:'+server.address().port+path);
        if(r.status!==200) throw new Error('HTTP smoke failed: '+path);
        await r.text();
      }
    } finally {await new Promise(resolve=>server.close(resolve));await pool.end();await shutdownTracing();}
  `;
  const child = spawn(process.execPath,['--import','./src/observability/tracing.js','--input-type=module','-e',source],{
    stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
      JWT_SECRET:'observability-smoke-only-secret-not-for-production',OTEL_EXPORTER_OTLP_ENDPOINT:`http://127.0.0.1:${collector.address().port}`}
  });
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0 || exportsReceived===0) throw new Error('Tracing export smoke failed');
  console.log(`Observability smoke passed: HTTP health/OpenAPI and ${exportsReceived} OTLP export request(s).`);
} finally {await new Promise(resolve=>collector.close(resolve));}
