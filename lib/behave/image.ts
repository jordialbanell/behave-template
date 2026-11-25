// Turns a browser data URL into bytes Bedrock accepts. The page shrinks photos before
// sending, so anything this large is a mistake, not a real meal.
import type { ImageInput } from "./ai";

const MAX_BYTES = 3_500_000;

export function imageFromDataUrl(v: unknown): ImageInput | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  const format = m[1] === "jpg" ? "jpeg" : (m[1] as "jpeg" | "png" | "webp");
  return { bytes: new Uint8Array(bytes), format };
}
