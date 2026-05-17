// In-memory Upstash-Redis double. Implements the surface we actually consume
// (`get`, `set` with `ex`/`nx`, `del`, `ttl`, `expire`, `incr`, `ping`).
// Returns a fresh instance per call so tests don't share state implicitly.

type SetOpts = { ex?: number; nx?: boolean };

export type MockRedis = {
  data: Map<string, unknown>;
  expirations: Map<string, number>;
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T, opts?: SetOpts) => Promise<'OK' | null>;
  del: (...keys: string[]) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  incr: (key: string) => Promise<number>;
  ping: () => Promise<'PONG'>;
};

export function createMockRedis(): MockRedis {
  const data = new Map<string, unknown>();
  const expirations = new Map<string, number>();

  const isExpired = (key: string): boolean => {
    const exp = expirations.get(key);
    if (exp === undefined) return false;
    if (Date.now() >= exp) {
      data.delete(key);
      expirations.delete(key);
      return true;
    }
    return false;
  };

  return {
    data,
    expirations,
    async get<T>(key: string): Promise<T | null> {
      if (isExpired(key)) return null;
      const v = data.get(key);
      return v === undefined ? null : (v as T);
    },
    async set<T>(key: string, value: T, opts?: SetOpts): Promise<'OK' | null> {
      if (opts?.nx && data.has(key) && !isExpired(key)) return null;
      data.set(key, value);
      if (opts?.ex !== undefined) {
        expirations.set(key, Date.now() + opts.ex * 1000);
      } else {
        expirations.delete(key);
      }
      return 'OK';
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const key of keys) {
        if (data.delete(key)) n++;
        expirations.delete(key);
      }
      return n;
    },
    async ttl(key: string): Promise<number> {
      if (!data.has(key)) return -2;
      const exp = expirations.get(key);
      if (exp === undefined) return -1;
      const remaining = Math.ceil((exp - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },
    async expire(key: string, seconds: number): Promise<number> {
      if (!data.has(key)) return 0;
      expirations.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    async incr(key: string): Promise<number> {
      const cur = Number(data.get(key) ?? 0);
      const next = cur + 1;
      data.set(key, next);
      return next;
    },
    async ping(): Promise<'PONG'> {
      return 'PONG';
    },
  };
}
