import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
const mockLaunch = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn().mockImplementation(() => ({ send: mockSend }));
  const GetObjectCommand = vi.fn().mockImplementation((input) => ({ ...input, _type: "GetObject" }));
  const PutObjectCommand = vi.fn().mockImplementation((input) => ({ ...input, _type: "PutObject" }));
  return { S3Client, GetObjectCommand, PutObjectCommand };
});

vi.mock("puppeteer-core", () => ({
  default: { launch: mockLaunch },
}));

vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: ["--no-sandbox", "--disable-gpu"],
    executablePath: vi.fn().mockResolvedValue("/tmp/chromium"),
  },
}));

import { handler, RendererEvent } from "./index";

describe("renderer handler", () => {
  const mockScreenshot = vi.fn();
  const mockSetContent = vi.fn();
  const mockPageClose = vi.fn();
  const mockBrowserClose = vi.fn();
  const mockNewPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = "test-bucket";

    mockScreenshot.mockResolvedValue(Buffer.from("fake-png-data"));
    mockSetContent.mockResolvedValue(undefined);
    mockPageClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      screenshot: mockScreenshot,
      close: mockPageClose,
    });
    mockLaunch.mockResolvedValue({
      newPage: mockNewPage,
      close: mockBrowserClose,
    });
  });

  it("should download HTML from S3, render PNG, and upload it", async () => {
    const htmlContent = "<!DOCTYPE html><html><body>Hello</body></html>";
    mockSend
      .mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
      })
      .mockResolvedValueOnce({});

    const event: RendererEvent = {
      s3Key: "prints/child1/abc123.html",
      bucketName: "my-bucket",
    };

    const result = await handler(event);

    expect(result).toEqual({ pngS3Key: "prints/child1/abc123.png" });

    // Verify S3 GetObject was called
    expect(mockSend).toHaveBeenCalledTimes(2);
    const getCall = mockSend.mock.calls[0][0];
    expect(getCall.Bucket).toBe("my-bucket");
    expect(getCall.Key).toBe("prints/child1/abc123.html");

    // Verify PutObject was called with PNG
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Bucket).toBe("my-bucket");
    expect(putCall.Key).toBe("prints/child1/abc123.png");
    expect(putCall.ContentType).toBe("image/png");
    expect(Buffer.isBuffer(putCall.Body)).toBe(true);

    // Verify Puppeteer was used correctly
    expect(mockLaunch).toHaveBeenCalledWith({
      args: ["--no-sandbox", "--disable-gpu"],
      defaultViewport: { width: 794, height: 1123 },
      executablePath: "/tmp/chromium",
      headless: true,
    });
    expect(mockSetContent).toHaveBeenCalledWith(htmlContent, { waitUntil: "networkidle0" });
    expect(mockScreenshot).toHaveBeenCalledWith({ fullPage: true });
    expect(mockPageClose).toHaveBeenCalled();
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("should use BUCKET_NAME env var when bucketName is not in event", async () => {
    const htmlContent = "<html><body>Test</body></html>";
    mockSend
      .mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
      })
      .mockResolvedValueOnce({});

    const event: RendererEvent = {
      s3Key: "prints/child1/xyz.html",
    };

    const result = await handler(event);

    expect(result).toEqual({ pngS3Key: "prints/child1/xyz.png" });
    const getCall = mockSend.mock.calls[0][0];
    expect(getCall.Bucket).toBe("test-bucket");
  });

  it("should throw when bucketName is not available", async () => {
    delete process.env.BUCKET_NAME;

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
    };

    await expect(handler(event)).rejects.toThrow(
      "bucketName is required (either in event or BUCKET_NAME env var)"
    );
  });

  it("should throw when s3Key is not provided", async () => {
    const event = { s3Key: "" } as RendererEvent;

    await expect(handler(event)).rejects.toThrow("s3Key is required in the event");
  });

  it("should close browser even if screenshot fails", async () => {
    const htmlContent = "<html><body>Test</body></html>";
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
    });
    mockScreenshot.mockRejectedValueOnce(new Error("Screenshot failed"));

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
      bucketName: "my-bucket",
    };

    await expect(handler(event)).rejects.toThrow("Screenshot failed");
    expect(mockBrowserClose).toHaveBeenCalled();
  });
});
