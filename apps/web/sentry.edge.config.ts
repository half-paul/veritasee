import * as Sentry from '@sentry/nextjs';
import { getSentryEnvironment } from '@/lib/observability';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: getSentryEnvironment(),

    sendDefaultPii: true,
    enableLogs: true,

    tracesSampler: (ctx) => {
      const url = ctx.normalizedRequest?.url ?? '';
      if (url.includes('/api/health/')) return 0;
      return process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0;
    },
  });
}
