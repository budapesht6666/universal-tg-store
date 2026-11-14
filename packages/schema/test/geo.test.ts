import { describe, expect, it } from "vitest";
import {
  isAllowedMapsRedirectHost,
  isGoogleMapsUrl,
  isShortMapsUrl,
  mapsUrlFromCoords,
  parseLocationText,
} from "../src/index.ts";

const at = (lat: number, lng: number) => ({ kind: "point", point: { lat, lng } });

describe("ссылки Google Maps", () => {
  it("узнаёт короткие и длинные ссылки", () => {
    expect(isShortMapsUrl("https://maps.app.goo.gl/AbC123")).toBe(true);
    expect(isShortMapsUrl("https://goo.gl/maps/xyz")).toBe(true);
    expect(isShortMapsUrl("https://goo.gl/other")).toBe(false);
    expect(isGoogleMapsUrl("https://www.google.com/maps/place/Hoi+An")).toBe(true);
    expect(isGoogleMapsUrl("https://maps.google.com/?q=15.88,108.33")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com.vn/maps/@15.88,108.33,17z")).toBe(true);
    expect(isGoogleMapsUrl("https://google.com/search?q=pho")).toBe(false);
    expect(isGoogleMapsUrl("https://evil.com/maps.app.goo.gl")).toBe(false);
    expect(isGoogleMapsUrl("https://google.com.evil.com/maps")).toBe(false);
    expect(isGoogleMapsUrl("javascript:alert(1)")).toBe(false);
  });

  it("сервер раскрывает перенаправления только по доменам Google", () => {
    expect(isAllowedMapsRedirectHost("maps.app.goo.gl")).toBe(true);
    expect(isAllowedMapsRedirectHost("www.google.com")).toBe(true);
    expect(isAllowedMapsRedirectHost("169.254.169.254")).toBe(false);
    expect(isAllowedMapsRedirectHost("localhost")).toBe(false);
    expect(isAllowedMapsRedirectHost("google.com.attacker.io")).toBe(false);
  });

  it("ссылка для курьера из координат", () => {
    expect(mapsUrlFromCoords(15.8801234, 108.338)).toBe(
      "https://maps.google.com/?q=15.880123,108.338000",
    );
  });
});

describe("разбор вставленного текста", () => {
  it("точка места в длинной ссылке важнее центра карты", () => {
    expect(
      parseLocationText(
        "https://www.google.com/maps/place/Pechka/@15.8790,108.3300,17z/data=!3m1!4b1!4m6!3m5!3d15.8801!4d108.338",
      ),
    ).toEqual(at(15.8801, 108.338));
    expect(parseLocationText("https://www.google.com/maps/@15.879,108.33,17z")).toEqual(
      at(15.879, 108.33),
    );
    expect(parseLocationText("https://maps.google.com/?q=15.8801,108.338")).toEqual(
      at(15.8801, 108.338),
    );
    expect(
      parseLocationText("https://www.google.com/maps/search/?api=1&query=15.8801%2C108.338"),
    ).toEqual(at(15.8801, 108.338));
  });

  it("ссылка внутри текста из «Поделиться» и короткие ссылки", () => {
    expect(parseLocationText("Вилла 12\nhttps://maps.app.goo.gl/AbC123")).toEqual({
      kind: "resolve",
      url: "https://maps.app.goo.gl/AbC123",
    });
  });

  it("просто координаты — из Zalo, Grab, самих карт", () => {
    expect(parseLocationText("15.8801, 108.3380")).toEqual(at(15.8801, 108.338));
    expect(parseLocationText("Мы тут: 15.8801 108.3380")).toEqual(at(15.8801, 108.338));
    expect(parseLocationText("-33.8688,151.2093")).toEqual(at(-33.8688, 151.2093));
  });

  it("непонятный текст — подсказка, что вставить", () => {
    expect(parseLocationText("ул. Ле Лой, 5")).toMatchObject({ kind: "invalid" });
    expect(parseLocationText("https://example.com/x")).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/^Не нашли точку/),
    });
    expect(parseLocationText("95.1, 108.3")).toMatchObject({ kind: "invalid" });
  });
});
