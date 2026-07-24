import { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const BUCKET_NAME = process.env.BUCKET_NAME || "";
const s3Client = new S3Client({});

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    if (!key.endsWith(".html")) {
      console.log(`Skipping non-HTML file: ${key}`);
      continue;
    }

    console.log(`Processing HTML file: ${key}`);

    try {
      // Read HTML from S3
      const getResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        })
      );

      const html = await getResponse.Body!.transformToString("utf-8");

      // Launch headless Chromium
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: {
          width: 794,
          height: 1123,
        },
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      // Render to PNG (A4 viewport 794x1123 at 96dpi)
      const pngBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
      });

      await browser.close();

      // Upload PNG to S3 with .png extension
      const pngKey = key.replace(/\.html$/, ".png");

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: pngKey,
          Body: pngBuffer,
          ContentType: "image/png",
        })
      );

      console.log(`Successfully rendered and uploaded: ${pngKey}`);
    } catch (error) {
      console.error(`Error processing ${key}:`, error);
      throw error;
    }
  }
}
