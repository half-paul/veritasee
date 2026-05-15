import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

type SentryCheckKind = 'message' | 'exception' | 'event' | 'fatal';

function isSentryCheckKind(value: unknown): value is SentryCheckKind {
  return (
    value === 'message' ||
    value === 'exception' ||
    value === 'event' ||
    value === 'fatal'
  );
}

export async function POST(req: Request) {
  let payload: unknown;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON payload.' }, { status: 400 });
  }

  const kind = typeof payload === 'object' && payload !== null && 'kind' in payload
    ? payload.kind
    : null;

  if (!isSentryCheckKind(kind)) {
    return NextResponse.json(
      { message: 'Expected kind to be one of message, exception, event, or fatal.' },
      { status: 400 },
    );
  }

  const commonContext = {
    tags: { source: 'sentry-check-page', runtime: 'server', kind },
    extra: { triggeredAt: new Date().toISOString() },
  };

  const eventId = (() => {
    switch (kind) {
      case 'message':
        return Sentry.captureMessage('Sentry check: server message', {
          level: 'info',
          ...commonContext,
        });
      case 'exception':
        return Sentry.captureException(
          new Error('Sentry check: handled server exception'),
          commonContext,
        );
      case 'event':
        return Sentry.captureEvent({
          message: 'Sentry check: custom server event',
          level: 'warning',
          tags: commonContext.tags,
          extra: commonContext.extra,
        });
      case 'fatal':
        return Sentry.captureEvent({
          message: 'Sentry check: fatal server event',
          level: 'fatal',
          tags: commonContext.tags,
          extra: commonContext.extra,
        });
    }
  })();

  await Sentry.flush(2000);

  return NextResponse.json({ eventId, kind });
}
