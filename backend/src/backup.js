import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const run = promisify(execFile);

/**
 * Retention: a daily dump every night for a week, plus Sunday's dump kept
 * separately for two months — enough history to recover from a mistake
 * noticed days later without keeping every single night forever.
 */
const DAILY_KEEP_DAYS = 7;
const WEEKLY_KEEP_DAYS = 56;

function r2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

/**
 * Dump the database, push it to R2 under daily/ (and also weekly/ on
 * Sundays), then prune anything past its retention window. Missing R2
 * credentials is a warning, not a failure — better to notice a misconfigured
 * bucket in the logs than to have the whole backup job crash-loop over it.
 */
export async function dbBackup() {
  const s3 = r2Client();
  if (!s3) {
    console.warn('dbBackup: R2 credentials not set, skipping (see .env.example)');
    return;
  }
  const bucket = process.env.R2_BUCKET || 'vibelink-db-backups';
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const file = `/tmp/vibelink-${stamp}.dump`;

  // Custom format: compressed, and pg_restore can go straight from it —
  // matches scripts/migration-snapshot.sh's approach for the same reason.
  await run('pg_dump', [process.env.DATABASE_URL, '-F', 'custom', '-f', file]);

  try {
    const body = await readFile(file);
    const keys = [`daily/vibelink-${stamp}.dump`];
    if (now.getUTCDay() === 0) keys.push(`weekly/vibelink-${stamp}.dump`);
    for (const Key of keys) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body }));
    }
  } finally {
    await unlink(file).catch(() => {});
  }

  await prune(s3, bucket, 'daily/', DAILY_KEEP_DAYS);
  await prune(s3, bucket, 'weekly/', WEEKLY_KEEP_DAYS);
}

async function prune(s3, bucket, prefix, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  for (const obj of Contents ?? []) {
    if (obj.LastModified && obj.LastModified.getTime() < cutoff) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
    }
  }
}
