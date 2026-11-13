/**
 * Единая точка импорта zod внутри пакета: включает русские сообщения об ошибках.
 * Настройка глобальная — она действует и в приложениях, которые импортируют @store/schema.
 */
import * as z from "zod";
import { ru } from "zod/locales";
import { russianErrorMap } from "./errors.ts";

z.config(ru());
z.config({ customError: russianErrorMap });

export { z };
