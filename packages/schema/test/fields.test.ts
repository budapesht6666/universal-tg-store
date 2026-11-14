import { describe, expect, it } from "vitest";
import { buildZodSchema, type FieldDefinition, FieldDefinitionSchema } from "../src/index.ts";

const defs: FieldDefinition[] = [
  FieldDefinitionSchema.parse({
    key: "name",
    label: "Имя",
    type: "text",
    required: true,
    maxLength: 20,
  }),
  FieldDefinitionSchema.parse({
    key: "density",
    label: "Плотность",
    type: "number",
    integer: true,
    min: 40,
    max: 600,
  }),
  FieldDefinitionSchema.parse({
    key: "material",
    label: "Материал",
    type: "select",
    options: ["Хлопок", "Лён"],
  }),
  FieldDefinitionSchema.parse({ key: "tags", label: "Метки", type: "tags", maxItems: 2 }),
  FieldDefinitionSchema.parse({ key: "color", label: "Цвет", type: "color" }),
];
const schema = buildZodSchema(defs);

const messages = (input: unknown) =>
  Object.fromEntries(
    (schema.safeParse(input).error?.issues ?? []).map((i) => [i.path.join("."), i.message]),
  );

describe("FieldDefinition", () => {
  it("описание поля проверяется: ключ, варианты, min ≤ max", () => {
    expect(
      FieldDefinitionSchema.safeParse({ key: "Material", label: "x", type: "text" }).success,
    ).toBe(false);
    expect(
      FieldDefinitionSchema.safeParse({ key: "m", label: "x", type: "select", options: ["a", "a"] })
        .success,
    ).toBe(false);
    const range = FieldDefinitionSchema.safeParse({
      key: "d",
      label: "x",
      type: "number",
      min: 10,
      max: 1,
    });
    expect(range.error?.issues[0]?.message).toBe("min больше max");
  });

  it("опечатка в ключе описания — ошибка, а не тихий пропуск", () => {
    const r = FieldDefinitionSchema.safeParse({
      key: "name",
      label: "Имя",
      type: "text",
      requird: true,
    });
    expect(r.error?.issues[0]?.message).toBe("Неизвестное поле «requird» — проверьте написание");
  });
});

describe("buildZodSchema", () => {
  it("пропускает корректные значения", () => {
    const r = schema.parse({
      name: " Анна ",
      density: 180,
      material: "Лён",
      tags: ["a"],
      color: "#1F73D6",
    });
    expect(r).toEqual({
      name: "Анна",
      density: 180,
      material: "Лён",
      tags: ["a"],
      color: "#1F73D6",
    });
  });

  it("пустые необязательные поля из формы считаются незаполненными", () => {
    expect(
      schema.parse({
        name: "Анна",
        density: "",
        material: "",
        color: null,
      }),
    ).toEqual({
      name: "Анна",
    });
  });

  it("сообщения об ошибках — по-русски и по делу", () => {
    expect(
      messages({
        name: "",
        density: 1.5,
        material: "Шёлк",
        tags: ["a", "b", "c"],
        color: "red",
      }),
    ).toEqual({
      name: "Обязательное поле",
      density: "Нужно целое число",
      material: "Выберите один из вариантов: Хлопок, Лён",
      tags: "Не больше 2 элементов",
      color: "Цвет в формате #RRGGBB, например #1F73D6",
    });
    expect(messages({ name: "x".repeat(21), density: 1000 })).toEqual({
      name: "Не длиннее 20 символов",
      density: "Не больше 600",
    });
  });

  it("неизвестные ключи — ошибка", () => {
    expect(messages({ name: "Анна", nmae: "x" })).toEqual({
      "": "Неизвестное поле «nmae» — проверьте написание",
    });
  });
});
