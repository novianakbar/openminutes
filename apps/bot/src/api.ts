const apiUrl = process.env.API_URL ?? "http://host.docker.internal:3000";
const internalToken = process.env.INTERNAL_TOKEN ?? "dev-internal-token";

async function post(path: string, body: unknown): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": internalToken,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Callback ${path} gagal: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Callback ${path} error:`, err);
  }
}

export function reportStatus(
  meetingId: string,
  status: string,
  error?: string,
): Promise<void> {
  console.log(`[status] ${status}${error ? ` (${error})` : ""}`);
  return post(`/internal/meetings/${meetingId}/status`, { status, error });
}

export function reportRecording(
  meetingId: string,
  objectKey: string,
  durationSec: number,
): Promise<void> {
  return post(`/internal/meetings/${meetingId}/recording`, {
    objectKey,
    durationSec,
  });
}
