/**
 * Renderer Lambda invocation utility.
 *
 * Invokes the PDF-based renderer Lambda synchronously.
 * The renderer converts HTML to PDF (via Puppeteer) and then to PNG pages
 * (via pdf-to-png-converter). For single-page output, `pngS3Key` holds the
 * primary key. For multi-page PDFs, each A4 page is uploaded as a separate
 * PNG and the full list is returned in `pngS3Keys`.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambdaClient = new LambdaClient({});

export interface InvokeRendererParams {
  s3Key: string;
  bucketName: string;
}

export interface RendererResult {
  pngS3Key: string;
  pngS3Keys?: string[];
}

/**
 * Invoke the renderer Lambda synchronously to convert an HTML file in S3 to
 * one or more PNG images. The renderer produces a PDF from the HTML, splits
 * it into A4 pages, and converts each page to PNG. The first page key is
 * returned as `pngS3Key` for backward compatibility; all page keys (including
 * the first) are available in `pngS3Keys`.
 */
export async function invokeRenderer(params: InvokeRendererParams): Promise<RendererResult> {
  const functionName = process.env.RENDERER_FUNCTION_NAME || "";
  if (!functionName) {
    throw new Error("RENDERER_FUNCTION_NAME environment variable is not configured");
  }

  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "RequestResponse",
    Payload: new TextEncoder().encode(JSON.stringify(params)),
  });

  const response = await lambdaClient.send(command);

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : "Unknown error";
    throw new Error(`Renderer Lambda error: ${errorPayload}`);
  }

  if (!response.Payload) {
    throw new Error("Renderer Lambda returned empty payload");
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload)) as RendererResult;
  return result;
}
