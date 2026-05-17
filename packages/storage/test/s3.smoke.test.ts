import { afterAll, describe, expect, it } from 'vitest';
import { deleteObject, getObject, putObject } from '../src';

const endpoint = process.env['S3_ENDPOINT'];
const region = process.env['S3_REGION'];
const accessKeyId = process.env['S3_ACCESS_KEY_ID'];
const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'];
const bucket = process.env['S3_BUCKET'];

describe('s3 storage smoke', () => {
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    console.warn(
      'S3_ENDPOINT/_REGION/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY/_BUCKET unset — skipping storage smoke test',
    );
    it.skip('PUT/GET/DELETE roundtrip (skipped: no s3 env)', () => {});
    return;
  }

  // Place test objects under the unanchored prefix so the lifecycle policy
  // auto-evicts any leaked objects within ~24h if delete fails.
  const key = `snapshots/unanchored/smoke-${Date.now()}.txt`;

  afterAll(async () => {
    try {
      await deleteObject(key);
    } catch {
      // best-effort; lifecycle policy will clean up
    }
  });

  it('PUT then GET returns the value', async () => {
    await putObject(key, 'ok', { contentType: 'text/plain' });
    const bytes = await getObject(key);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('ok');
  });

  it('DELETE then GET throws NoSuchKey', async () => {
    await deleteObject(key);
    await expect(getObject(key)).rejects.toThrow();
  });
});
