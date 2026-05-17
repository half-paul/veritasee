import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { S3Client } = vi.hoisted(() => ({
  S3Client: vi.fn((_config: unknown) => ({})),
}));

vi.mock('@aws-sdk/client-s3', async () => {
  const real = await vi.importActual<object>('@aws-sdk/client-s3');
  return { ...real, S3Client };
});

const ENV_KEYS = [
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
] as const;

const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe('@veritasee/storage getS3 / getBucket', () => {
  beforeEach(() => {
    vi.resetModules();
    S3Client.mockClear();
    for (const k of ENV_KEYS) SAVED[k] = process.env[k];
    process.env.S3_REGION = 'auto';
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_ACCESS_KEY_ID = 'AKIA';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET = 'veritasee-test';
    delete process.env.S3_FORCE_PATH_STYLE;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (SAVED[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED[k];
    }
  });

  it('passes env into the S3Client constructor', async () => {
    const { getS3 } = await import('../src/client');
    getS3();
    expect(S3Client).toHaveBeenCalledWith({
      region: 'auto',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      },
      forcePathStyle: false,
    });
  });

  it.each([
    ['true', true],
    ['1', true],
    ['YES', true],
    ['false', false],
    ['0', false],
    ['', false],
  ] as const)('parses S3_FORCE_PATH_STYLE=%j as %j', async (raw, expected) => {
    process.env.S3_FORCE_PATH_STYLE = raw;
    const { getS3 } = await import('../src/client');
    getS3();
    const call = S3Client.mock.calls[0]?.[0] as { forcePathStyle?: boolean };
    expect(call?.forcePathStyle).toBe(expected);
  });

  it('memoizes the client across calls', async () => {
    const { getS3 } = await import('../src/client');
    const a = getS3();
    const b = getS3();
    expect(a).toBe(b);
    expect(S3Client).toHaveBeenCalledTimes(1);
  });

  it('getBucket returns S3_BUCKET', async () => {
    const { getBucket } = await import('../src/client');
    expect(getBucket()).toBe('veritasee-test');
  });

  it('getBucket throws when S3_BUCKET is missing', async () => {
    delete process.env.S3_BUCKET;
    const { getBucket } = await import('../src/client');
    expect(() => getBucket()).toThrow(/S3_BUCKET/);
  });
});
