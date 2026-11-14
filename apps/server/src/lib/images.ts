/**
 * Фото блюда: любое изображение до 10 МБ → WebP до 1200 px по большей стороне.
 * Файлы лежат в UPLOADS_DIR, отдаются по /uploads/<имя>.webp.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { AppError } from "../errors.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1200;

export async function saveImage(file: File, dir: string): Promise<{ url: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, "Фото больше 10 МБ — уменьшите его");
  if (!file.type.startsWith("image/"))
    throw new AppError(415, "Нужна картинка: JPG, PNG, WebP или HEIC");
  let output: Buffer;
  try {
    output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "error" })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AppError(415, "Не получилось прочитать картинку — попробуйте другой файл");
  }
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(9).toString("base64url")}.webp`;
  await writeFile(join(dir, name), output);
  return { url: `/uploads/${name}` };
}
