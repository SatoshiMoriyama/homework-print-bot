import { describe, it, expect, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed-url.example.com"),
}));

vi.mock("@aws-sdk/client-s3", () => {
  const GetObjectCommand = vi.fn().mockImplementation((input) => input);
  const S3Client = vi.fn().mockImplementation(() => ({}));
  return { S3Client, GetObjectCommand };
});

import { getPresignedUrl } from "./s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

describe("getPresignedUrl", () => {
  it("should call getSignedUrl with correct parameters and default expiresIn", async () => {
    const url = await getPresignedUrl("my-bucket", "prints/test.png");

    expect(url).toBe("https://signed-url.example.com");
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "my-bucket",
      Key: "prints/test.png",
    });
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ Bucket: "my-bucket", Key: "prints/test.png" }),
      { expiresIn: 21600 }
    );
  });

  it("should use custom expiresIn when provided", async () => {
    await getPresignedUrl("my-bucket", "prints/test.png", 1800);

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ Bucket: "my-bucket", Key: "prints/test.png" }),
      { expiresIn: 1800 }
    );
  });
});
