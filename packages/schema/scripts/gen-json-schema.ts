/** Генерирует catalog/catalog.schema.json из zod-схемы. Запуск: pnpm schema:gen */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogJsonSchema } from "../src/json-schema.ts";

const target = fileURLToPath(new URL("../../../catalog/catalog.schema.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(catalogJsonSchema(), null, 2)}\n`);
console.log(`JSON Schema записана: ${target}`);
