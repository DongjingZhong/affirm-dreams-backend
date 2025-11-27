// src/lib/s3.ts
// All comments in English only.

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.AWS_S3_BUCKET;

if (!BUCKET) {
  throw new Error("Missing AWS_S3_BUCKET env variable");
}

// Single shared S3 client
export const s3 = new S3Client({
  region: REGION,
});

/**
 * Upload user avatar image to S3.
 */
export async function uploadUserAvatarToS3(
  userId: string,
  buffer: Buffer,
  mime: string
): Promise<{ key: string; url: string }> {
  const contentType = mime || "image/jpeg";

  // Very small helper to pick extension
  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
      ? "webp"
      : "jpg";

  const key = `avatars/user_${userId}/avatar-${Date.now()}.${ext}`;

  console.log("S3 upload params =", {
    bucket: BUCKET,
    region: REGION,
    key,
    contentType,
  });

  const putCmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // IMPORTANT: do NOT set ACL here, bucket has ACLs disabled
    // ACL: "public-read", // ❌ this would cause AccessControlListNotSupported
  });

  await s3.send(putCmd);

  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  return { key, url };
}

/**
 * Delete an existing avatar object from S3.
 */
export async function deleteUserAvatarFromS3(
  key?: string | null
): Promise<void> {
  if (!key) return;

  console.log("Deleting avatar from S3:", { bucket: BUCKET, key });

  const delCmd = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await s3.send(delCmd);
}
