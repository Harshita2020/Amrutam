import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Opt-in exporter; preload before Express/pg so their calls can be instrumented.
let sdk;
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  sdk = new NodeSDK({ serviceName: 'amrutam-backend', traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
      '@opentelemetry/instrumentation-http': { requestHook(span, req) {
        // Never export query strings that may carry user-provided filters.
        const path = (req.path ?? req.url ?? '').split('?')[0];
        span.setAttribute('url.full', path);
        span.setAttribute('http.url', path);
        span.setAttribute('http.target', path);
      } }
    })] });
  sdk.start();
}
export async function shutdownTracing() { await sdk?.shutdown(); }
