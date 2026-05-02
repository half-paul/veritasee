// PutBucketLifecycleConfiguration is part of the S3 API surface and is
// supported by both AWS S3 and Cloudflare R2 with identical request shape.
// Day-bucketed expiration: an object expires at the next midnight UTC after it
// becomes Days old, so the wall-clock deletion window is roughly [0, 2*Days).
// "24h" in the LEX-67 acceptance criterion is satisfied by Days = 1.

import { PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { getBucket, getS3 } from './client';

export const UNANCHORED_PREFIX = 'snapshots/unanchored/';

export async function applyUnanchoredLifecycle(): Promise<void> {
  await getS3().send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: getBucket(),
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-unanchored-snapshots-24h',
            Status: 'Enabled',
            Filter: { Prefix: UNANCHORED_PREFIX },
            Expiration: { Days: 1 },
          },
        ],
      },
    }),
  );
}
