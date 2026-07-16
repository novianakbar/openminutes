import { Client as MinioClient } from "minio";

const bucket = process.env.MINIO_BUCKET ?? "recordings";

const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? "host.docker.internal",
  port: Number(process.env.MINIO_PORT ?? "9000"),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY ?? "minio",
  secretKey: process.env.MINIO_SECRET_KEY ?? "minio12345",
});

export async function uploadRecording(
  meetingId: string,
  filePath: string,
): Promise<string> {
  const objectKey = `${meetingId}.ogg`;
  await minio.fPutObject(bucket, objectKey, filePath, {
    "Content-Type": "audio/ogg",
  });
  return objectKey;
}

export async function uploadScreenshot(
  meetingId: string,
  index: number,
  buffer: Buffer,
): Promise<string> {
  const objectKey = `${meetingId}/screenshots/${String(index).padStart(3, "0")}.png`;
  await minio.putObject(bucket, objectKey, buffer, buffer.length, {
    "Content-Type": "image/png",
  });
  return objectKey;
}
