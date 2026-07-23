/**
 * AgentCore Runtime client for invoking the homework-print-bot agent.
 */
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";

const AGENTCORE_RUNTIME_ARN = process.env.AGENTCORE_RUNTIME_ARN || "";

const client = new BedrockAgentCoreClient({});

export interface AgentPayload {
  action: string;
  child_id: string;
  [key: string]: unknown;
}

/**
 * Invoke the AgentCore Runtime and return the parsed JSON response.
 * Uses a session ID based on the LINE user ID for session affinity.
 */
export async function invokeAgent(payload: AgentPayload, sessionId: string): Promise<Record<string, unknown>> {
  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: AGENTCORE_RUNTIME_ARN,
    runtimeSessionId: sessionId,
    payload: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await client.send(command);

  // Collect streaming response
  const chunks: string[] = [];
  const responseBody = response.response;

  if (responseBody) {
    if (Symbol.asyncIterator in Object(responseBody)) {
      // Streaming response
      for await (const chunk of responseBody as AsyncIterable<Uint8Array>) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    } else if (typeof responseBody === "object" && "transformToString" in (responseBody as object)) {
      // SdkStreamMixin
      chunks.push(await (responseBody as { transformToString: () => Promise<string> }).transformToString());
    }
  }

  const raw = chunks.join("");

  // Parse response - handle event-stream format
  const lines = raw.split("\n").filter((line) => line.startsWith("data: "));
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1].replace("data: ", "");
    try {
      return JSON.parse(lastLine) as Record<string, unknown>;
    } catch {
      // If last line isn't valid JSON, concatenate all data lines
      const combined = lines.map((l) => l.replace("data: ", "")).join("");
      try {
        return JSON.parse(combined) as Record<string, unknown>;
      } catch {
        return { result: combined };
      }
    }
  }

  // Try parsing as plain JSON
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { result: raw };
  }
}
