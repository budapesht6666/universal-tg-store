import { type CatalogIssue, issuesFromZod, type z } from "@store/schema";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 503;

/** Ошибка, которую видит пользователь: текст по-русски, для форм — ошибки по полям. */
export class AppError extends Error {
  readonly status: ErrorStatus;
  readonly issues: CatalogIssue[] | undefined;

  constructor(status: ErrorStatus, message: string, issues?: CatalogIssue[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

/** Проверка входных данных схемой из @store/schema; ошибки — с путями до полей. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return unwrap(schema.safeParse(data));
}

/** Результат safeParse → данные или ошибка 400 с ошибками по полям. */
export function unwrap<T>(
  r: { success: true; data: T } | { success: false; error: z.ZodError },
): T {
  if (r.success) return r.data;
  const issues = issuesFromZod(r.error);
  throw new AppError(400, issues[0]?.message ?? "Проверьте данные", issues);
}
