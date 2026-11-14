import { createHmac, randomBytes } from "node:crypto";

/** Случайный токен для ссылок (приглашение, вход): 128 бит, base64url. */
export function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

/** В БД храним не сам токен, а HMAC от него: утечка базы не даёт войти по старым ссылкам. */
export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}
