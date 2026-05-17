// Unit tests for @veritasee/storage object helpers. Uses aws-sdk-client-mock so
// no real S3/R2 traffic is generated; pure assertion on command inputs.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteObject, getObject, headBucket, putObject } from '../src/objects';

const s3Mock = mockClient(S3Client);

const ENV = {
  S3_REGION: 'auto',
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_ACCESS_KEY_ID: 'AKIA-test',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'veritasee-test',
};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
});

afterAll(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
});

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

describe('putObject', () => {
  it('sends a PutObjectCommand with the bucket, key, body, and content type', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await putObject('snapshots/a.txt', 'hello', { contentType: 'text/plain' });
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      Bucket: 'veritasee-test',
      Key: 'snapshots/a.txt',
      Body: 'hello',
      ContentType: 'text/plain',
    });
  });

  it('omits ContentType when not provided', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await putObject('snapshots/b.bin', new Uint8Array([1, 2, 3]));
    const input = s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(input?.ContentType).toBeUndefined();
  });
});

describe('getObject', () => {
  it('returns the bytes from the response body', async () => {
    const transformToByteArray = async () => new Uint8Array([1, 2, 3]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray } as unknown as ReturnType<typeof Object>,
    });
    const bytes = await getObject('snapshots/a.txt');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('throws when the response body is empty', async () => {
    s3Mock.on(GetObjectCommand).resolves({});
    await expect(getObject('snapshots/missing')).rejects.toThrow(/empty body/);
  });
});

describe('deleteObject', () => {
  it('sends a DeleteObjectCommand', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    await deleteObject('snapshots/a.txt');
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});

describe('headBucket', () => {
  it('sends a HeadBucketCommand against the configured bucket', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    await headBucket();
    const input = s3Mock.commandCalls(HeadBucketCommand)[0]?.args[0].input;
    expect(input?.Bucket).toBe('veritasee-test');
  });

  it('surfaces AWS errors (caller checks $metadata.httpStatusCode)', async () => {
    s3Mock.on(HeadBucketCommand).rejects(
      Object.assign(new Error('not found'), {
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(headBucket()).rejects.toThrow('not found');
  });
});
