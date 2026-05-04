export { getBucket, getS3, s3 } from './client';
export {
  deleteObject,
  getObject,
  headBucket,
  putObject,
  type PutObjectOptions,
} from './objects';
export { applyUnanchoredLifecycle, UNANCHORED_PREFIX } from './lifecycle';
export type { S3Client } from '@aws-sdk/client-s3';
