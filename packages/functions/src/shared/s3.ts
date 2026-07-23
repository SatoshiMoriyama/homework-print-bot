import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});

const DEFAULT_EXPIRES_IN = 3600;

export async function getPresignedUrl(bucket: string, key: string, expiresIn: number = DEFAULT_EXPIRES_IN): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}
