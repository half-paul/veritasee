import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getBucket, getS3 } from './client';

export interface PutObjectOptions {
  contentType?: string;
  cacheControl?: string;
}

export async function putObject(
  key: string,
  body: Uint8Array | string,
  opts: PutObjectOptions = {},
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl,
    }),
  );
}

export async function getObject(key: string): Promise<Uint8Array> {
  const response = await getS3().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );
  if (!response.Body) {
    throw new Error(`getObject ${key}: empty body`);
  }
  return response.Body.transformToByteArray();
}

export async function deleteObject(key: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

export async function headBucket(): Promise<void> {
  await getS3().send(new HeadBucketCommand({ Bucket: getBucket() }));
}
