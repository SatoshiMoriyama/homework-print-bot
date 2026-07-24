/**
 * Renderer Lambda invocation utility.
 *
 * Invokes the html-to-png renderer Lambda synchronously and returns the PNG S3 key.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambdaClient = new LambdaClient({});

export interface InvokeRendererParams {
  s3Key: string;
  bucketName: string;
}

export interface RendererResult {
  pngS3Key: string;
}

/**
 * Invoke the renderer Lambda synchronously to convert an HTML file in S3 to PNG.
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
