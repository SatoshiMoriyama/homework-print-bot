/**
 * HTML-to-PNG Renderer Lambda
 *
 * Downloads HTML from S3, renders it to PNG using Puppeteer + @sparticuz/chromium,
 * and uploads the PNG back to S3 with the .html extension replaced by .png.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const s3Client = new S3Client({});

export interface RendererEvent {
  s3Key: string;
  bucketName?: string;
}

export interface RendererResponse {
  pngS3Key: string;
}

export async function handler(event: RendererEvent): Promise<RendererResponse> {
  const bucketName = event.bucketName || process.env.BUCKET_NAME || "";
  const { s3Key } = event;

  if (!bucketName) {
    throw new Error("bucketName is required (either in event or BUCKET_NAME env var)");
  }
  if (!s3Key) {
    throw new Error("s3Key is required in the event");
  }
  if (!s3Key.endsWith(".html")) {
    throw new Error(`s3Key must have .html extension, got: ${s3Key}`);
  }

  // Download HTML from S3
  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  });
  const getResponse = await s3Client.send(getCommand);
  if (!getResponse.Body) {
    throw new Error(`S3 GetObject returned no Body for key: ${s3Key}`);
  }
  const html = await getResponse.Body.transformToString("utf-8");

  // Launch browser with @sparticuz/chromium
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 794, height: 1123 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  let pngBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const screenshot = await page.screenshot({ fullPage: true });
    pngBuffer = Buffer.from(screenshot);
    await page.close();
  } finally {
    await browser.close();
  }

  // Upload PNG to S3, replacing .html extension with .png
  const pngS3Key = s3Key.replace(/\.html$/, ".png");
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: pngS3Key,
    Body: pngBuffer,
    ContentType: "image/png",
  });
  await s3Client.send(putCommand);

  return { pngS3Key };
}
