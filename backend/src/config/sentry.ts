import * as Sentry from '@sentry/node';

// Must load before express, pg and http are required, so the SDK can hook
// them; server.ts imports this straight after dotenv. Without SENTRY_DSN the
// SDK stays off, which keeps laptops, tests and the demo backend out of the
// production project.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Not NODE_ENV: EC2 runs with NODE_ENV=development, which would file
    // every production error under "development". A laptop that sets a DSN
    // sets SENTRY_ENVIRONMENT=local alongside it.
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    // Traces are sampled lightly: Prometheus already owns latency, so these
    // only need to be enough to explain a slow request once one is spotted.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // The background sweeps and the TCP server report trouble through
    // console.warn/error rather than throwing; forward those as Sentry logs.
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
  });
}

export { Sentry };
