/**
 * HTML-to-PNG Renderer Lambda
 *
 * Downloads HTML from S3, renders it to PDF using Puppeteer + @sparticuz/chromium,
 * converts the PDF pages to PNGs using pdf-to-png-converter,
 * and uploads the PNGs back to S3.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { pdfToPng } from "pdf-to-png-converter";
import * as fs from "fs";
import * as path from "path";

const s3Client = new S3Client({});

// ---------------------------------------------------------------------------
// Font setup: Copy Noto Sans JP to /tmp/fonts so Chromium can find it
// ---------------------------------------------------------------------------
const FONTS_DIR = "/tmp/fonts";
const SOURCE_FONTS_DIR = path.join(__dirname, "fonts");

function setupFonts(): void {
  if (fs.existsSync(path.join(FONTS_DIR, "NotoSansJP-Regular.ttf"))) {
    return; // Already set up (warm start)
  }

  fs.mkdirSync(FONTS_DIR, { recursive: true });

  // Copy font files
  const fontSrc = path.join(SOURCE_FONTS_DIR, "NotoSansJP-Regular.ttf");
  if (fs.existsSync(fontSrc)) {
    fs.copyFileSync(fontSrc, path.join(FONTS_DIR, "NotoSansJP-Regular.ttf"));
  }

  const emojiSrc = path.join(SOURCE_FONTS_DIR, "NotoColorEmoji-Regular.ttf");
  if (fs.existsSync(emojiSrc)) {
    fs.copyFileSync(emojiSrc, path.join(FONTS_DIR, "NotoColorEmoji-Regular.ttf"));
  }

  // Copy fonts.conf
  const confSrc = path.join(SOURCE_FONTS_DIR, "fonts.conf");
  if (fs.existsSync(confSrc)) {
    fs.copyFileSync(confSrc, path.join(FONTS_DIR, "fonts.conf"));
  }

  // Set environment variables for fontconfig
  process.env.FONTCONFIG_PATH = FONTS_DIR;
  process.env.FONTCONFIG_FILE = path.join(FONTS_DIR, "fonts.conf");
}

setupFonts();

export interface RendererEvent {
  s3Key: string;
  bucketName?: string;
}

export interface RendererResponse {
  pngS3Key: string;
  pngS3Keys: string[];
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
  chromium.setGraphicsMode = false;
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--font-render-hinting=none"],
    defaultViewport: { width: 794, height: 1123 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfData = await page.pdf({ format: "A4", printBackground: true });
    pdfBuffer = Buffer.from(pdfData);
    await page.close();
  } finally {
    await browser.close();
  }

  // Convert PDF to PNG pages
  const pngPages = await pdfToPng(pdfBuffer);

  // Upload each PNG page to S3
  const baseKey = s3Key.replace(/\.html$/, "");
  const pngS3Keys: string[] = [];

  for (let i = 0; i < pngPages.length; i++) {
    const pageKey = i === 0 ? `${baseKey}.png` : `${baseKey}_page${i + 1}.png`;
    pngS3Keys.push(pageKey);

    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: pageKey,
      Body: pngPages[i].content,
      ContentType: "image/png",
    });
    await s3Client.send(putCommand);
  }

  return {
    pngS3Key: pngS3Keys[0],
    pngS3Keys,
  };
}
