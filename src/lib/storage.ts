import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 when R2_* env vars are set; otherwise local disk under ./storage (dev only —
 * most hosts like Vercel have an ephemeral filesystem, so set up R2 before deploying).
 */
const useR2 = Boolean(
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET,
);

const s3 = useR2
  ? new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    })
  : null;

const LOCAL_ROOT = path.join(process.cwd(), "storage");

function localPath(key: string) {
  const p = path.join(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid storage key");
  return p;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const p = localPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

/** Returns either a short-lived signed URL (R2) or the raw bytes (local). */
export async function getObject(key: string): Promise<{ url: string } | { body: Buffer }> {
  if (s3) {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 300 });
    return { url };
  }
  return { body: await fs.readFile(localPath(key)) };
}

export async function deleteObject(key: string) {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return;
  }
  await fs.rm(localPath(key), { force: true });
}
