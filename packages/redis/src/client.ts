import { Redis } from '@upstash/redis';
import { requireEnv } from './env';

let cached: Redis | undefined;

export function getRedis(): Redis {
  if (!cached) {
    cached = new Redis({
      url: requireEnv('UPSTASH_REDIS_REST_URL'),
      token: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
    });
  }
  return cached;
}

export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    return Reflect.get(getRedis() as object, prop, receiver);
  },
});
