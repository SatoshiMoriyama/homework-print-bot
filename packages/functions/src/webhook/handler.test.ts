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

vi.mock("../shared/s3", () => ({
  getPresignedUrl: vi.fn().mockResolvedValue("https://presigned.example.com/image.png"),
}));

import { sendPrintImage } from "./handler";
import { getPresignedUrl } from "../shared/s3";

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
