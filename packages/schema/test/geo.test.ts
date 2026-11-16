import { describe, expect, it } from "vitest";
import {
  isAllowedMapsRedirectHost,
  isAppleMapsUrl,
  isGoogleMapsUrl,
  isShortMapsUrl,
  mapsUrlFromCoords,
  parseLocationText,
} from "../src/index.ts";

const at = (lat: number, lng: number, via = "google", label?: string) =>
  label
    ? { kind: "point", point: { lat, lng }, via, label }
    : { kind: "point", point: { lat, lng }, via };

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
    ).toEqual(at(15.8801, 108.338, "google", "Pechka"));
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
      via: "google",
    });
  });

  it("Apple Maps: координаты в ссылке, короткие ссылки и страницы места — серверу", () => {
    expect(
      parseLocationText("https://maps.apple.com/?ll=16.0680424,108.2143557&q=Dropped%20Pin"),
    ).toEqual(at(16.0680424, 108.2143557, "apple"));
    expect(
      parseLocationText(
        "https://maps.apple.com/place?coordinate=16.068,108.2143&name=Con%20Market",
      ),
    ).toEqual(at(16.068, 108.2143, "apple", "Con Market"));
    expect(parseLocationText("Con Market https://maps.apple/p/EoH2bXiuMFPqgK")).toEqual({
      kind: "resolve",
      url: "https://maps.apple/p/EoH2bXiuMFPqgK",
      via: "apple",
    });
    expect(
      parseLocationText("https://maps.apple.com/place?place-id=IFEA9459921CAA709"),
    ).toMatchObject({ kind: "resolve", via: "apple" });
    expect(isAppleMapsUrl("https://maps.apple.com.evil.io/p/x")).toBe(false);
    expect(isAllowedMapsRedirectHost("maps.apple")).toBe(true);
    expect(isAllowedMapsRedirectHost("apple.com")).toBe(false);
  });

  it("просто координаты — из Zalo, Grab, самих карт", () => {
    expect(parseLocationText("15.8801, 108.3380")).toEqual(at(15.8801, 108.338, "coords"));
    expect(parseLocationText("Мы тут: 15.8801 108.3380")).toEqual(at(15.8801, 108.338, "coords"));
    expect(parseLocationText("-33.8688,151.2093")).toEqual(at(-33.8688, 151.2093, "coords"));
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
