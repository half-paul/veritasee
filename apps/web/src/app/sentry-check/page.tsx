import type { Metadata } from 'next';
import { SentryCheckPanel } from './SentryCheckPanel';

export const metadata: Metadata = {
  title: 'Sentry Check | Veritasee Override',
  description: 'Trigger Sentry test events from Veritasee Override.',
};

export default function SentryCheckPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">
          Observability
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Sentry event check</h1>
        <p className="max-w-2xl text-sm leading-6 text-foreground/70">
          Send a mix of handled errors, custom events, and messages to confirm that
          browser and server telemetry are both wired correctly.
        </p>
      </div>

      <SentryCheckPanel />
    </main>
  );
}
