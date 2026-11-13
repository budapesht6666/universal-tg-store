import { CatalogSchema } from "./catalog.ts";
import { z } from "./zod.ts";

/**
 * JSON Schema каталога для автодополнения и подсказок в VS Code.
 * io: "input" — описывает то, что пишет человек: поля со значениями по умолчанию необязательны.
 */
export function catalogJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(CatalogSchema, { io: "input", target: "draft-2020-12" });
}
