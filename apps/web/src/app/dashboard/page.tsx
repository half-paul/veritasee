import { auth, currentUser } from '@clerk/nextjs/server';
import { resolveRole } from '@/lib/auth/roles';
import { UrlEntryForm } from './components/UrlEntryForm';

export default async function DashboardPage() {
  const { sessionClaims } = await auth();
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? 'unknown';
  const role = resolveRole(sessionClaims);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="mt-4 rounded-lg border border-black/10 p-4">
        <p>Signed in as <span className="font-medium">{email}</span></p>
        <p className="text-sm text-black/60">role: {role}</p>
      </div>
      <section className="mt-6">
        <h2 className="text-lg font-medium">Submit a URL</h2>
        <p className="mt-1 text-sm text-black/60">
          Submit an HTTPS article URL to validate it before viewing.
        </p>
        <div className="mt-3">
          <UrlEntryForm />
        </div>
      </section>
    </main>
  );
}
