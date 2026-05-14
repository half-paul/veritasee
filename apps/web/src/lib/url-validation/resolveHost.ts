import { promises as dns } from 'node:dns';
import ipaddr from 'ipaddr.js';

export type ResolveResult =
  | { ok: true; addresses: ReadonlyArray<string> }
  | { ok: false; reason: 'lookup_failed' };

// Resolves a hostname to all A/AAAA records. If `hostname` is already an IP
// literal, the literal is returned directly without a DNS lookup. Errors are
// flattened into a non-throwing discriminated result so the caller can decide
// what to log.
export async function resolveHost(hostname: string): Promise<ResolveResult> {
  if (ipaddr.isValid(hostname)) {
    return { ok: true, addresses: [hostname] };
  }
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return { ok: true, addresses: records.map((r) => r.address) };
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }
}
