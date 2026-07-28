import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
const mockLaunch = vi.hoisted(() => vi.fn());
const mockPdfToPng = vi.hoisted(() => vi.fn());

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
    setGraphicsMode: false,
  },
}));

vi.mock("pdf-to-png-converter", () => ({
  pdfToPng: mockPdfToPng,
}));

import { handler, RendererEvent } from "./index";

describe("renderer handler", () => {
  const mockPdf = vi.fn();
  const mockSetContent = vi.fn();
  const mockPageClose = vi.fn();
  const mockBrowserClose = vi.fn();
  const mockNewPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = "test-bucket";

    mockPdf.mockResolvedValue(Buffer.from("fake-pdf-data"));
    mockSetContent.mockResolvedValue(undefined);
    mockPageClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockPageClose,
    });
    mockLaunch.mockResolvedValue({
      newPage: mockNewPage,
      close: mockBrowserClose,
    });
    mockPdfToPng.mockResolvedValue([
      { content: Buffer.from("fake-png-page1"), name: "page_1.png" },
    ]);
  });

  it("should download HTML from S3, render PDF, convert to PNG, and upload it", async () => {
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

    expect(result).toEqual({
      pngS3Key: "prints/child1/abc123.png",
      pngS3Keys: ["prints/child1/abc123.png"],
    });

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
      args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
      defaultViewport: { width: 794, height: 1123 },
      executablePath: "/tmp/chromium",
      headless: true,
    });
    expect(mockSetContent).toHaveBeenCalledWith(htmlContent, { waitUntil: "networkidle0" });
    expect(mockPdf).toHaveBeenCalledWith({ format: "A4", printBackground: true });
    expect(mockPageClose).toHaveBeenCalled();
    expect(mockBrowserClose).toHaveBeenCalled();

    // Verify pdfToPng was called with the PDF buffer
    expect(mockPdfToPng).toHaveBeenCalledWith(Buffer.from("fake-pdf-data"));
  });

  it("should handle multi-page PDF and upload all pages", async () => {
    const htmlContent = "<html><body>Multi-page content</body></html>";
    mockSend
      .mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    mockPdfToPng.mockResolvedValue([
      { content: Buffer.from("png-page1"), name: "page_1.png" },
      { content: Buffer.from("png-page2"), name: "page_2.png" },
      { content: Buffer.from("png-page3"), name: "page_3.png" },
    ]);

    const event: RendererEvent = {
      s3Key: "prints/child1/abc123.html",
      bucketName: "my-bucket",
    };

    const result = await handler(event);

    expect(result).toEqual({
      pngS3Key: "prints/child1/abc123.png",
      pngS3Keys: [
        "prints/child1/abc123.png",
        "prints/child1/abc123_page2.png",
        "prints/child1/abc123_page3.png",
      ],
    });

    // GetObject + 3 PutObject calls
    expect(mockSend).toHaveBeenCalledTimes(4);

    const putCall1 = mockSend.mock.calls[1][0];
    expect(putCall1.Key).toBe("prints/child1/abc123.png");
    expect(putCall1.ContentType).toBe("image/png");

    const putCall2 = mockSend.mock.calls[2][0];
    expect(putCall2.Key).toBe("prints/child1/abc123_page2.png");
    expect(putCall2.ContentType).toBe("image/png");

    const putCall3 = mockSend.mock.calls[3][0];
    expect(putCall3.Key).toBe("prints/child1/abc123_page3.png");
    expect(putCall3.ContentType).toBe("image/png");
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

    expect(result).toEqual({
      pngS3Key: "prints/child1/xyz.png",
      pngS3Keys: ["prints/child1/xyz.png"],
    });
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

  it("should throw when pdfToPng returns an empty array", async () => {
    const htmlContent = "<html><body>Empty PDF</body></html>";
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
    });
    mockPdfToPng.mockResolvedValue([]);

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
      bucketName: "my-bucket",
    };

    await expect(handler(event)).rejects.toThrow(
      "pdfToPng returned no pages: the PDF may be empty or corrupted"
    );
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("should throw when pdfToPng throws an exception", async () => {
    const htmlContent = "<html><body>Bad PDF</body></html>";
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
    });
    mockPdfToPng.mockRejectedValue(new Error("Invalid PDF structure"));

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
      bucketName: "my-bucket",
    };

    await expect(handler(event)).rejects.toThrow("Invalid PDF structure");
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("should close browser even if pdf generation fails", async () => {
    const htmlContent = "<html><body>Test</body></html>";
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
    });
    mockPdf.mockRejectedValueOnce(new Error("PDF generation failed"));

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
      bucketName: "my-bucket",
    };

    await expect(handler(event)).rejects.toThrow("PDF generation failed");
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("should throw when pdfToPng returns a page with undefined content", async () => {
    const htmlContent = "<html><body>Broken page</body></html>";
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(htmlContent) },
    });
    mockPdfToPng.mockResolvedValue([
      { content: undefined, name: "page_1.png" },
    ]);

    const event: RendererEvent = {
      s3Key: "prints/child1/abc.html",
      bucketName: "my-bucket",
    };

    await expect(handler(event)).rejects.toThrow(
      "pdfToPng returned undefined content for page 1"
    );
    // Should not have attempted to upload
    expect(mockSend).toHaveBeenCalledTimes(1); // Only the GetObject call
  });
});
