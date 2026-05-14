'use client';

import { useState, type FormEvent } from 'react';

type SuccessResult = {
  ok: true;
  normalizedUrl: string;
  hostname: string;
};

type ErrorPayload = {
  ok: false;
  code: string;
  error: string;
};

export function UrlEntryForm() {
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuccessResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/proxy/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => null)) as
        | SuccessResult
        | ErrorPayload
        | null;

      if (res.ok && data && data.ok === true) {
        setResult(data);
        return;
      }

      const message =
        data && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'Validation failed.';
      setError(message);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-black/10 p-4"
    >
      <label htmlFor="url-input" className="block text-sm font-medium">
        Article URL
      </label>
      <input
        id="url-input"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/article"
        maxLength={2048}
        required
        disabled={pending}
        className="mt-2 w-full rounded-md border border-black/10 px-3 py-2 text-sm focus:border-black/30 focus:outline-none focus:ring-1 focus:ring-black/30 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={pending || url.length === 0}
        className="mt-3 rounded-md border border-black/10 bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Validating…' : 'Validate'}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <p className="font-medium">URL accepted.</p>
          <p className="mt-1 break-all">Normalized: {result.normalizedUrl}</p>
          <p className="mt-0.5">Host: {result.hostname}</p>
        </div>
      )}
    </form>
  );
}
