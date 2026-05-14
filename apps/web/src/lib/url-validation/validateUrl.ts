import { isDenylisted, loadDenylist } from './denylist';
import { isPrivateAddress } from './privateIp';
import { resolveHost } from './resolveHost';
import { MAX_URL_LENGTH, type ValidationResult } from './types';

// Pure orchestrator: scheme → length → parse → denylist → resolve → privateIp.
// Returns a discriminated result; never throws. Callers map the result to an
// HTTP status (see app/api/proxy/validate/route.ts).
export async function validateUrl(input: string): Promise<ValidationResult> {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, code: 'invalid_url', message: 'URL is required.' };
  }
  if (input.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      code: 'too_long',
      message: `URL exceeds the maximum length of ${MAX_URL_LENGTH} characters.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'URL could not be parsed.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'invalid_scheme',
      message: 'Only HTTPS URLs are accepted.',
    };
  }

  // WHATWG URL preserves the surrounding `[...]` on IPv6 literals (e.g.
  // `https://[::1]/` → hostname `[::1]`). Strip them so downstream checks
  // (ipaddr.parse, dns.lookup) receive the bare address.
  const rawHost = parsed.hostname.toLowerCase();
  const hostname =
    rawHost.startsWith('[') && rawHost.endsWith(']')
      ? rawHost.slice(1, -1)
      : rawHost;
  if (hostname.length === 0) {
    return { ok: false, code: 'invalid_url', message: 'URL is missing a hostname.' };
  }

  if (isDenylisted(hostname, loadDenylist())) {
    return {
      ok: false,
      code: 'denylisted',
      message: 'This domain is not allowed.',
      hostname,
    };
  }

  const resolved = await resolveHost(hostname);
  if (!resolved.ok) {
    return {
      ok: false,
      code: 'dns_failure',
      message: 'Could not resolve host.',
      hostname,
    };
  }

  for (const address of resolved.addresses) {
    if (isPrivateAddress(address)) {
      return {
        ok: false,
        code: 'private_ip',
        message: 'URL resolves to a private or non-routable address.',
        hostname,
        address,
      };
    }
  }

  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    hostname,
  };
}
