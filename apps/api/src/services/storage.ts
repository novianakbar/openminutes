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
  contentType?: string;
}

export async function getStoredObject(
  objectKey: string,
): Promise<RecordingObject | null> {
  try {
    const stat = await minio.statObject(config.minio.bucket, objectKey);
    const stream = await minio.getObject(config.minio.bucket, objectKey);
    return {
      stream,
      sizeBytes: stat.size,
      contentType: stat.metaData?.["content-type"],
    };
  } catch (err) {
    if ((err as { code?: string })?.code === "NoSuchKey") return null;
    throw err;
  }
}

export async function getRecording(
  objectKey: string,
): Promise<RecordingObject | null> {
  return getStoredObject(objectKey);
}

export async function putStoredObject(
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await minio.putObject(config.minio.bucket, objectKey, buffer, buffer.length, {
    "Content-Type": contentType,
  });
}

export async function deleteStoredObject(objectKey: string): Promise<void> {
  try {
    await minio.removeObject(config.minio.bucket, objectKey);
  } catch (err) {
    if ((err as { code?: string })?.code === "NoSuchKey") return;
    throw err;
  }
}

export async function deleteRecording(objectKey: string): Promise<void> {
  await deleteStoredObject(objectKey);
}
