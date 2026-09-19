import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readdir, stat, unlink, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const run = promisify(execFile);

/**
 * Retention: a daily dump every night for a week, plus Sunday's dump kept
 * separately for two months — enough history to recover from a mistake
 * noticed days later without keeping every single night forever.
 */
const DAILY_KEEP_DAYS = 7;
const WEEKLY_KEEP_DAYS = 56;

/**
 * Where the on-server copy lives: a named volume mounted at /backups
 * (docker-compose.prod.yml). It works with no outside account at all, which
 * is what makes it the default — but it sits on the same machine as the
 * database, so it protects against a bad migration or a deleted row, not
 * against losing the server. R2 below is the off-site copy.
 */
const LOCAL_DIR = process.env.BACKUP_DIR ?? '/backups';

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
 * Dump the database, check the dump can actually be read back, keep it on the
 * server under daily/ (and weekly/ on Sundays), and also push it to R2 when
 * credentials are set. Old copies past their retention window are pruned.
 *
 * This used to do nothing at all unless R2 credentials were set, which meant
 * a fresh install had no backups and nothing saying so. It now always keeps a
 * local copy, and any destination that fails makes the job fail — the
 * Automation screen records failures, so a broken backup is visible rather
 * than silent.
 */
export async function dbBackup() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const name = `vibelink-${stamp}.dump`;
  const sunday = now.getUTCDay() === 0;
  const tmp = `/tmp/${name}`;
  const problems = [];

  // Custom format: compressed, and pg_restore can go straight from it —
  // matches scripts/migration-snapshot.sh's approach for the same reason.
  await run('pg_dump', [process.env.DATABASE_URL, '-F', 'custom', '-f', tmp]);

  try {
    // A truncated or unreadable dump is worse than none: it looks like a
    // backup until the day it is needed. Listing the archive's contents is
    // quick and fails on a damaged file.
    await run('pg_restore', ['--list', tmp], { maxBuffer: 256 * 1024 * 1024 });

    let saved = 0;

    try {
      await saveLocal(tmp, name, sunday);
      saved += 1;
    } catch (e) {
      problems.push(`local copy failed: ${e.message}`);
    }

    const s3 = r2Client();
    if (s3) {
      try {
        await uploadR2(s3, tmp, name, sunday);
        saved += 1;
      } catch (e) {
        problems.push(`R2 upload failed: ${e.message}`);
      }
    } else {
      console.warn('dbBackup: R2 credentials not set — backup is on this server only (see .env.example)');
    }

    if (!saved) problems.push('no backup destination worked');
  } finally {
    await unlink(tmp).catch(() => {});
  }

  if (problems.length) throw new Error(problems.join('; '));
}

async function saveLocal(tmp, name, sunday) {
  const targets = ['daily', ...(sunday ? ['weekly'] : [])];
  for (const dir of targets) {
    const folder = `${LOCAL_DIR}/${dir}`;
    await mkdir(folder, { recursive: true });
    // Written under a temporary name and renamed, so a half-written file is
    // never mistaken for a finished backup if the container stops mid-copy.
    await copyFile(tmp, `${folder}/${name}.partial`);
    await rename(`${folder}/${name}.partial`, `${folder}/${name}`);
  }
  await pruneLocal(`${LOCAL_DIR}/daily`, DAILY_KEEP_DAYS);
  await pruneLocal(`${LOCAL_DIR}/weekly`, WEEKLY_KEEP_DAYS);
}

async function pruneLocal(folder, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let names;
  try {
    names = await readdir(folder);
  } catch {
    return; // nothing kept in this folder yet
  }
  for (const n of names) {
    const info = await stat(`${folder}/${n}`);
    if (info.mtimeMs < cutoff) await unlink(`${folder}/${n}`);
  }
}

async function uploadR2(s3, tmp, name, sunday) {
  const bucket = process.env.R2_BUCKET || 'vibelink-db-backups';
  const keys = [`daily/${name}`, ...(sunday ? [`weekly/${name}`] : [])];
  const { size } = await stat(tmp);
  for (const Key of keys) {
    // Streamed with a known length instead of read into memory whole: the
    // dump grows with the customer base, and this process is also the API.
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key, Body: createReadStream(tmp), ContentLength: size,
    }));
  }
  await pruneR2(s3, bucket, 'daily/', DAILY_KEEP_DAYS);
  await pruneR2(s3, bucket, 'weekly/', WEEKLY_KEEP_DAYS);
}

async function pruneR2(s3, bucket, prefix, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  for (const obj of Contents ?? []) {
    if (obj.LastModified && obj.LastModified.getTime() < cutoff) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
    }
  }
}
