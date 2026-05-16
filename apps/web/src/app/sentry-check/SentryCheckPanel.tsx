'use client';

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';

type ServerEventKind = 'message' | 'exception' | 'event' | 'fatal';

type EventResult = {
  label: string;
  status: 'sent' | 'failed' | 'triggered';
  detail: string;
};

const serverEvents: Array<{
  kind: ServerEventKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'message',
    label: 'Server message',
    description: 'Captures an informational server-side message.',
  },
  {
    kind: 'exception',
    label: 'Handled server exception',
    description: 'Captures an Error object inside the API route.',
  },
  {
    kind: 'event',
    label: 'Custom server event',
    description: 'Captures a structured event with tags and extra context.',
  },
  {
    kind: 'fatal',
    label: 'Fatal server event',
    description: 'Captures a fatal-level event without crashing the request.',
  },
];

export function SentryCheckPanel() {
  const [results, setResults] = useState<EventResult[]>([]);
  const [pendingKind, setPendingKind] = useState<ServerEventKind | null>(null);

  function addResult(result: EventResult) {
    setResults((current) => [result, ...current].slice(0, 8));
  }

  function captureClientMessage() {
    const eventId = Sentry.captureMessage('Sentry check: client message', {
      level: 'info',
      tags: { source: 'sentry-check-page', runtime: 'browser' },
      extra: { triggeredAt: new Date().toISOString() },
    });

    addResult({
      label: 'Client message',
      status: 'sent',
      detail: `Captured with event id ${eventId}`,
    });
  }

  function captureClientException() {
    const error = new Error('Sentry check: handled client exception');
    const eventId = Sentry.captureException(error, {
      tags: { source: 'sentry-check-page', runtime: 'browser' },
      extra: { triggeredAt: new Date().toISOString() },
    });

    addResult({
      label: 'Handled client exception',
      status: 'sent',
      detail: `Captured with event id ${eventId}`,
    });
  }

  function triggerUnhandledClientError() {
    addResult({
      label: 'Unhandled client error',
      status: 'triggered',
      detail: 'A timer will throw outside React event handling.',
    });

    window.setTimeout(() => {
      throw new Error('Sentry check: unhandled client error');
    }, 0);
  }

  async function captureServerEvent(kind: ServerEventKind) {
    setPendingKind(kind);

    try {
      const response = await fetch('/api/_sentry-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json()) as {
        eventId?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.message ?? 'Server event failed');
      }

      addResult({
        label: serverEvents.find((event) => event.kind === kind)?.label ?? kind,
        status: 'sent',
        detail: `Captured with event id ${body.eventId ?? 'unavailable'}`,
      });
    } catch (error) {
      addResult({
        label: serverEvents.find((event) => event.kind === kind)?.label ?? kind,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingKind(null);
    }
  }

  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={captureClientMessage}
            className="rounded border border-foreground/15 px-4 py-3 text-left transition hover:border-foreground/45 hover:bg-foreground/5"
          >
            <span className="block text-sm font-semibold">Client message</span>
            <span className="mt-1 block text-sm text-foreground/65">
              Captures an info-level message from the browser.
            </span>
          </button>

          <button
            type="button"
            onClick={captureClientException}
            className="rounded border border-foreground/15 px-4 py-3 text-left transition hover:border-foreground/45 hover:bg-foreground/5"
          >
            <span className="block text-sm font-semibold">Handled client exception</span>
            <span className="mt-1 block text-sm text-foreground/65">
              Sends an Error via captureException.
            </span>
          </button>

          <button
            type="button"
            onClick={triggerUnhandledClientError}
            className="rounded border border-red-500/35 px-4 py-3 text-left transition hover:border-red-500 hover:bg-red-500/10"
          >
            <span className="block text-sm font-semibold">Unhandled client error</span>
            <span className="mt-1 block text-sm text-foreground/65">
              Throws from a timer so Sentry can catch the crash path.
            </span>
          </button>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Server-side events</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {serverEvents.map((event) => (
              <button
                key={event.kind}
                type="button"
                onClick={() => void captureServerEvent(event.kind)}
                disabled={pendingKind !== null}
                className="rounded border border-foreground/15 px-4 py-3 text-left transition hover:border-foreground/45 hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="block text-sm font-semibold">
                  {pendingKind === event.kind ? 'Sending...' : event.label}
                </span>
                <span className="mt-1 block text-sm text-foreground/65">
                  {event.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="min-h-64 rounded border border-foreground/15 p-4">
        <h2 className="text-lg font-semibold">Recent sends</h2>
        {results.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/65">
            Trigger an event to see the local result here.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {results.map((result, index) => (
              <li key={`${result.label}-${index}`} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{result.label}</span>
                  <span className="rounded bg-foreground px-2 py-0.5 text-xs text-background">
                    {result.status}
                  </span>
                </div>
                <p className="mt-1 break-words text-foreground/65">{result.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
