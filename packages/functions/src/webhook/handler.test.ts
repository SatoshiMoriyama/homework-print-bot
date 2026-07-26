import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to set env vars and define mocks before module evaluation (vi.mock is hoisted above normal code)
const mockPushMessage = vi.hoisted(() => {
  process.env.LINE_CHANNEL_SECRET_PARAM = "/test/secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN_PARAM = "/test/token";
  process.env.BUCKET_NAME = "test-bucket";
  return vi.fn().mockResolvedValue({});
});

vi.mock("@line/bot-sdk", () => ({
  validateSignature: vi.fn(),
  Client: vi.fn().mockImplementation(() => ({
    pushMessage: mockPushMessage,
    replyMessage: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-ssm", () => {
  const send = vi.fn().mockResolvedValue({
    Parameter: { Value: "dummy-value" },
  });
  const SSMClient = vi.fn().mockImplementation(() => ({ send }));
  const GetParameterCommand = vi.fn().mockImplementation((input) => input);
  return { SSMClient, GetParameterCommand };
});

vi.mock("@aws-sdk/client-s3", () => {
  const send = vi.fn().mockResolvedValue({});
  const S3Client = vi.fn().mockImplementation(() => ({ send }));
  const PutObjectCommand = vi.fn().mockImplementation((input) => input);
  const GetObjectCommand = vi.fn().mockImplementation((input) => input);
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

vi.mock("../shared/s3", () => ({
  getPresignedUrl: vi.fn().mockResolvedValue("https://presigned.example.com/image.png"),
}));

vi.mock("../shared/renderer", () => ({
  invokeRenderer: vi.fn().mockResolvedValue({ pngS3Key: "prints/test.png" }),
}));

vi.mock("../shared/state", () => ({
  getUserState: vi.fn().mockResolvedValue({
    line_user_id: "user123",
    active_child_id: "child-1",
    last_print_id: null,
    waiting_for_text_answer: false,
    pending_questions: [],
  }),
  createOrUpdateState: vi.fn().mockResolvedValue(undefined),
  setLastPrintId: vi.fn().mockResolvedValue(undefined),
  clearWaitingState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../shared/family", () => ({
  getParent: vi.fn().mockResolvedValue({ family_id: "family-1", line_user_id: "user123" }),
  createParent: vi.fn(),
  getChildrenByFamily: vi.fn().mockResolvedValue([{ child_id: "child-1", nickname: "たろう" }]),
  createChild: vi.fn(),
  findChildByNickname: vi.fn(),
}));

vi.mock("../shared/agentcore", () => ({
  invokeAgent: vi.fn().mockResolvedValue({
    print_id: "print-123",
    s3_key: "prints/child-1/print-123.html",
    needs_rendering: true,
    questions: [],
  }),
}));

vi.mock("./command-parser", () => ({
  parseCommand: vi.fn().mockReturnValue({ type: "print_request" }),
  isModificationInstruction: vi.fn().mockReturnValue(false),
  parseTextAnswers: vi.fn().mockReturnValue([]),
}));

import { handler, sendPrintImage } from "./handler";
import { getPresignedUrl } from "../shared/s3";
import { invokeRenderer } from "../shared/renderer";
import { invokeAgent } from "../shared/agentcore";
import { validateSignature } from "@line/bot-sdk";

describe("sendPrintImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = "test-bucket";
  });

  it("should throw when BUCKET_NAME is not set", async () => {
    delete process.env.BUCKET_NAME;

    await expect(sendPrintImage("user123", "prints/test.png")).rejects.toThrow(
      'Environment variable "BUCKET_NAME" is not configured'
    );
  });

  it("should call getPresignedUrl and pushMessage with correct image message shape", async () => {
    await sendPrintImage("user123", "prints/test.png");

    expect(getPresignedUrl).toHaveBeenCalledWith("test-bucket", "prints/test.png");
    expect(mockPushMessage).toHaveBeenCalledWith("user123", {
      type: "image",
      originalContentUrl: "https://presigned.example.com/image.png",
      previewImageUrl: "https://presigned.example.com/image.png",
    });
  });

  it("should log error and rethrow when getPresignedUrl fails", async () => {
    const error = new Error("S3 error");
    vi.mocked(getPresignedUrl).mockRejectedValueOnce(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendPrintImage("user123", "prints/test.png")).rejects.toThrow("S3 error");

    expect(consoleSpy).toHaveBeenCalledWith("Failed to send print image", {
      userId: "user123",
      s3Key: "prints/test.png",
      error,
    });
    consoleSpy.mockRestore();
  });

  it("should log error and rethrow when pushMessage fails", async () => {
    const error = new Error("LINE API rate limit");
    mockPushMessage.mockRejectedValueOnce(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendPrintImage("user123", "prints/test.png")).rejects.toThrow("LINE API rate limit");

    expect(consoleSpy).toHaveBeenCalledWith("Failed to send print image", {
      userId: "user123",
      s3Key: "prints/test.png",
      error,
    });
    consoleSpy.mockRestore();
  });
});

describe("needs_rendering flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = "test-bucket";
    process.env.RENDERER_FUNCTION_NAME = "test-renderer";
    vi.mocked(validateSignature).mockReturnValue(true);
  });

  function makeWebhookEvent(text: string) {
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "reply-token-1",
          source: { userId: "user123" },
          message: { type: "text", text },
        },
      ],
    });
    return {
      headers: { "x-line-signature": "valid-sig" },
      body,
      isBase64Encoded: false,
      httpMethod: "POST",
      path: "/webhook",
      pathParameters: null,
      queryStringParameters: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
    };
  }

  it("should invoke renderer when needs_rendering is true and use returned pngS3Key", async () => {
    vi.mocked(invokeAgent).mockResolvedValueOnce({
      print_id: "print-abc",
      s3_key: "prints/child-1/print-abc.html",
      needs_rendering: true,
      questions: [{ q: "1+1" }],
    });
    vi.mocked(invokeRenderer).mockResolvedValueOnce({ pngS3Key: "prints/child-1/print-abc.png" });

    const result = await handler(makeWebhookEvent("プリント"));

    expect(result.statusCode).toBe(200);
    expect(invokeAgent).toHaveBeenCalledWith({
      action: "generate_print",
      child_id: "child-1",
    }, "user123");
    expect(invokeRenderer).toHaveBeenCalledWith({
      s3Key: "prints/child-1/print-abc.html",
      bucketName: "test-bucket",
    });
    expect(getPresignedUrl).toHaveBeenCalledWith("test-bucket", "prints/child-1/print-abc.png");
  });

  it("should not invoke renderer when needs_rendering is falsy", async () => {
    vi.mocked(invokeAgent).mockResolvedValueOnce({
      print_id: "print-xyz",
      s3_key: "prints/child-1/print-xyz.png",
      questions: [{ q: "2+3" }],
    });

    const result = await handler(makeWebhookEvent("プリント"));

    expect(result.statusCode).toBe(200);
    expect(invokeRenderer).not.toHaveBeenCalled();
    expect(getPresignedUrl).toHaveBeenCalledWith("test-bucket", "prints/child-1/print-xyz.png");
  });

  it("should handle renderer invocation failure gracefully", async () => {
    vi.mocked(invokeAgent).mockResolvedValueOnce({
      print_id: "print-err",
      s3_key: "prints/child-1/print-err.html",
      needs_rendering: true,
      questions: [{ q: "3+4" }],
    });
    vi.mocked(invokeRenderer).mockRejectedValueOnce(new Error("Renderer timeout"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handler(makeWebhookEvent("プリント"));

    expect(result.statusCode).toBe(200);
    expect(invokeRenderer).toHaveBeenCalled();
    // Error is caught and user gets an error message via pushMessage
    expect(mockPushMessage).toHaveBeenCalledWith("user123", {
      type: "text",
      text: "プリント生成中にエラーが発生しました。もう一度試してね。",
    });
    consoleSpy.mockRestore();
  });
});
