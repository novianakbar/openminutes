import { Client as MinioClient } from "minio";
import type { Readable } from "node:stream";
import { config } from "../config";

const minio = new MinioClient({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: false,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

export interface RecordingObject {
  stream: Readable;
  sizeBytes: number;
}

export async function getRecording(
  objectKey: string,
): Promise<RecordingObject | null> {
  try {
    const stat = await minio.statObject(config.minio.bucket, objectKey);
    const stream = await minio.getObject(config.minio.bucket, objectKey);
    return { stream, sizeBytes: stat.size };
  } catch (err) {
    if ((err as { code?: string })?.code === "NoSuchKey") return null;
    throw err;
  }
}

export async function deleteRecording(objectKey: string): Promise<void> {
  try {
    await minio.removeObject(config.minio.bucket, objectKey);
  } catch (err) {
    if ((err as { code?: string })?.code === "NoSuchKey") return;
    throw err;
  }
}
