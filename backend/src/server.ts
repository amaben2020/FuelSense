import 'dotenv/config';
import './config/timezone';
import './config/env';

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './config/openapi';
import rateLimit from 'express-rate-limit';
import { initDatabase, pool } from './config/db';
import { startTcpServer } from './features/tracker/tcp-server';
import { registry, metricsMiddleware, registerPoolMetrics } from './config/metrics';

import authRoutes from './features/auth/auth.routes';
import vehicleRoutes from './features/vehicles/vehicles.routes';
import deviceRoutes from './features/devices/devices.routes';
import telemetryRoutes from './features/telemetry/telemetry.routes';
import alertRoutes from './features/alerts/alerts.routes';
import orderRoutes from './features/orders/orders.routes';
import dashboardRoutes from './features/dashboard/dashboard.routes';
import driverRoutes from './features/drivers/drivers.routes';
import intelligenceRoutes from './features/intelligence/intelligence.routes';
import maintenanceRoutes from './features/maintenance/maintenance.routes';
import geofenceRoutes from './features/geofences/geofences.routes';
import driverPortalRoutes from './features/driver-portal/driver-portal.routes';
import fuelEventsRoutes from './features/fuel/fuel-events.routes';
import deviceEventsRoutes from './features/devices/device-events.routes';
import placesRoutes from './features/places/places.routes';
import featureRoutes from './features/feature-flags/feature-flags.routes';
import fuelPriceRoutes from './features/fuel/fuel-price.routes';
import contactRoutes from './features/contact/contact.routes';
import { startReceiptSweep } from './features/receipts/receipt-sweep.service';
import { startRouteSweep } from './features/route-corridor/route-sweep.service';
import { startDrivingEventSweep } from './features/telemetry/driving-events-sweep.service';
import { startDailyReportScheduler } from './features/reports/daily-report-mailer.service';
import { startDeviceOfflineWatchdog } from './features/devices/device-offline-watchdog.service';
import { startAlertRetentionSweep } from './features/alerts/alert-retention.service';
import { startDeviceFrameRetentionSweep } from './features/devices/frame-retention.service';
import { startTelemetryPartitionSweep } from './features/telemetry/telemetry-partitions.service';
import { startTelemetryRetentionSweep } from './features/telemetry/telemetry-retention.service';
import { startCertificateExpirySweep } from './features/certificates/certificate-expiry-sweep.service';
import { startServiceReminderSweep } from './features/maintenance/service-reminder-sweep.service';
import certificateRoutes from './features/certificates/certificates.routes';
import adminRoutes from './features/admin/admin.routes';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(
    'http://localhost:3000',
    'https://fuelsense.ng',
    'https://www.fuelsense.ng',
    'http://localhost:3001',
  );
}

// Opening CORS to everything is opt-in per machine, and deliberately NOT tied
// to NODE_ENV: the EC2 box runs with NODE_ENV=development, so keying off that
// would have silently opened the internet-facing API to any origin with
// credentials. A laptop sets CORS_ALLOW_ALL=true in its own .env — which never
// deploys, since rsync excludes it — and every other host stays on the
// allowlist by default.
const ALLOW_ALL_ORIGINS = process.env.CORS_ALLOW_ALL === 'true';

const app = express();
// EC2 sits behind Caddy (:80 → 127.0.0.1:5001); trust its X-Forwarded-For so
// express-rate-limit keys on the real client IP instead of throwing.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  ALLOW_ALL_ORIGINS
    ? // Reflect whatever asked, rather than `*`: a wildcard is invalid
      // alongside credentials, so cookie-authenticated calls would fail even
      // though the intent here is to allow everything.
      cors({ origin: (origin, cb) => cb(null, origin ?? true), credentials: true })
    : cors({
        origin: (origin, cb) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
          cb(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
      }),
);

app.use(metricsMiddleware);
registerPoolMetrics(pool);

/**
 * Prometheus scrape target.
 *
 * Mounted ahead of the rate limiter — a scrape every 15s is not abuse, and a
 * throttled scrape produces a gap in the graph that looks exactly like the
 * outage you are trying to diagnose.
 *
 * Not public. The series carry device IMEIs, and `app.set('trust proxy')` above
 * means `req.ip` is the real client even behind Caddy on EC2 — so the default
 * rule (loopback and private ranges only) lets the Docker-network Prometheus in
 * and keeps the internet out. Setting METRICS_TOKEN switches to a bearer check
 * instead, for a scraper that is not on the same network.
 */
const METRICS_TOKEN = process.env.METRICS_TOKEN;

const mayScrape = (req: Request): boolean => {
  if (METRICS_TOKEN) {
    return req.get('authorization') === `Bearer ${METRICS_TOKEN}`;
  }
  const ip = (req.ip ?? '').replace(/^::ffff:/, '');
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
};

app.get('/metrics', async (req: Request, res: Response) => {
  if (!mayScrape(req)) {
    res.status(404).end();
    return;
  }
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Generous global cap — the dashboard legitimately polls many endpoints, so this
// only guards against runaway abuse. Brute-force protection lives on /api/auth.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 900,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

app.use(globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Browsable API reference, and the raw document for client generators.
//
// Mounted before the authenticated routers so the docs themselves need no
// token — the spec describes the API, it does not expose any fleet's data.
// Helmet's default CSP blocks Swagger UI's inline styles, so it is disabled for
// this subtree only rather than weakened globally.
app.get('/api/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});
app.use(
  '/api/docs',
  helmet({ contentSecurityPolicy: false }),
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'FuelSense API',
    swaggerOptions: { docExpansion: 'none', defaultModelsExpandDepth: 0 },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/geofences', geofenceRoutes);
app.use('/api/driver', driverPortalRoutes);
app.use('/api/fuel-events', fuelEventsRoutes);
app.use('/api/device-events', deviceEventsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/features', featureRoutes);
app.use('/api/fuel-price', fuelPriceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/admin', adminRoutes);

const start = async () => {
  await initDatabase();
  await startTcpServer();

  // Receipts whose evidence arrived after they were submitted, and forecourt
  // stops nobody logged a receipt for.
  startReceiptSweep();

  // Trips against the route they were expected to take. Runs behind the
  // telemetry pipeline so a slow Directions lookup can never delay a frame.
  startRouteSweep();

  // Harsh acceleration, braking and cornering, derived from the speed and
  // heading series the tracker already sends.
  startDrivingEventSweep();

  // Yesterday's driving, per driver, emailed as a PDF each morning.
  startDailyReportScheduler();

  // Notices a tracker going silent on its own, rather than waiting for a
  // manager to have the dashboard open when it happens.
  startDeviceOfflineWatchdog();

  // Closes alerts that have aged out of being actionable. Without it nothing
  // but the offline watchdog ever resolved anything, so open alerts only
  // accumulated and dragged the health score down over time rather than in
  // response to how the fleet was actually driven.
  startAlertRetentionSweep();

  // Expires raw AVL frames past the window anything still reads. The widest
  // row the platform writes, and nothing was ever deleting it — one vehicle
  // made 21 MB a month, so a fleet would grow this unbounded.
  startDeviceFrameRetentionSweep();

  // Keeps next month's telemetry child in existence before a tracker needs
  // it. A no-op until the table has been converted (npm run
  // db:partition-telemetry); after that, the one thing standing between a
  // month boundary and refused inserts.
  startTelemetryPartitionSweep();

  // Off unless TELEMETRY_RETENTION_DAYS is set. The demo database sets it so
  // the simulated fleet recycles a week at a time on a free tier; production
  // does not, and keeps the fleet's history whole.
  startTelemetryRetentionSweep();

  // A week's notice before a vehicle licence lapses, in the alert feed and
  // by email for those who opted in. Hourly; the deadline is in days.
  startCertificateExpirySweep();

  // Oil changes, tyres and the rest: told to the manager when they fall due,
  // once per interval, through the same feed as everything else.
  startServiceReminderSweep();

  const port = Number(process.env.PORT ?? 5001);
  app.listen(port, () => {
    console.log(`Express server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);

    const simulatorEnabled =
      process.env.ENABLE_FLEET_SIMULATOR === 'true' &&
      process.env.NODE_ENV !== 'production';

    if (simulatorEnabled) {
      setTimeout(async () => {
        try {
          const { runFleetSimulator, withResolvedOrigins } = await import('./features/simulator/fleet-simulator');
          // FLEET_SIM_PROFILES=blue-fleet plays the sales-demo fleet; anything
          // else keeps the five-vehicle development set. Origins resolve from
          // each device's last seeded fix, so the cars start where the week
          // of history left them.
          if (process.env.FLEET_SIM_PROFILES === 'blue-fleet') {
            const { BLUE_FLEET_PROFILES, simulatorProfile } = await import('./features/simulator/blue-fleet');
            const profiles = await withResolvedOrigins(BLUE_FLEET_PROFILES.map(simulatorProfile));
            runFleetSimulator(profiles);
          } else {
            runFleetSimulator();
          }
          console.log('Fleet simulator started (dev only)');
        } catch (err) {
          console.warn(
            'Fleet simulator failed to start:',
            (err as Error).message,
          );
        }
      }, 2500);
    } else {
      console.log(
        `Fleet simulator disabled — expecting real Teltonika devices on TCP port ${process.env.TCP_PORT ?? 5027}`,
      );
    }
  });
};

// A hard stop for the demo backend. The demo database is a Neon free tier,
// which bills compute by the hour the endpoint is awake — and it only sleeps
// once every connection is gone. A backend left running on a laptop after a
// demo holds its pool open all night and burns the month's allowance for
// nothing. Unset in production, where the service is meant to run forever.
const maxRuntimeHours = Number(process.env.MAX_RUNTIME_HOURS || 0);
if (maxRuntimeHours > 0) {
  const timer = setTimeout(() => {
    console.log(`[max_runtime] ${maxRuntimeHours}h reached — exiting so the demo database can sleep`);
    process.exit(0);
  }, maxRuntimeHours * 3600_000);
  timer.unref?.();
  console.log(`[max_runtime] this process will exit after ${maxRuntimeHours}h`);
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
