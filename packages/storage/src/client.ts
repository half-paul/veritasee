// Node-only: do not import from Edge-runtime routes. The AWS SDK v3 module is
// heavy and incompatible with the Edge runtime. Routes that consume this client
// must declare `runtime = 'nodejs'`.

import { S3Client } from '@aws-sdk/client-s3';
import { optionalEnv, requireEnv } from './env';

let cached: S3Client | undefined;

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function getS3(): S3Client {
  if (!cached) {
    cached = new S3Client({
      region: requireEnv('S3_REGION'),
      endpoint: requireEnv('S3_ENDPOINT'),
      credentials: {
        accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: parseBool(optionalEnv('S3_FORCE_PATH_STYLE')),
    });
  }
  return cached;
}

export function getBucket(): string {
  return requireEnv('S3_BUCKET');
}

export const s3: S3Client = new Proxy({} as S3Client, {
  get(_target, prop, receiver) {
    return Reflect.get(getS3() as object, prop, receiver);
  },
});
