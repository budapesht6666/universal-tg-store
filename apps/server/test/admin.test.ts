import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  acceptInvite,
  createInvite,
  createLoginToken,
  rolesOf,
  upsertUser,
} from "../src/repo/team.ts";
import { ANNA, NOON, OWNER, openShop, PUBLIC_URL, setup } from "./helpers.ts";

describe("меню в админке", () => {
  it("категория: id из названия, удалить можно только пустую", async () => {
    const t = setup();
    await openShop(t);
    expect(
      (await t.call("POST", "/api/admin/categories", { as: ANNA, body: { title: "Напитки" } }))
        .status,
    ).toBe(403);
    const cat = await t.call("POST", "/api/admin/categories", {
      as: OWNER,
      body: { title: "Напитки" },
    });
    expect(cat.json).toEqual({ id: "napitki", title: "Напитки", sort: 70 });
    const again = await t.call("POST", "/api/admin/categories", {
      as: OWNER,
      body: { title: "Напитки" },
    });
    expect(again.json.id).toBe("napitki-2");
    expect((await t.call("DELETE", "/api/admin/categories/soups", { as: OWNER })).status).toBe(409);
    expect((await t.call("DELETE", "/api/admin/categories/napitki-2", { as: OWNER })).status).toBe(
      200,
    );
  });

  it("блюдо: создание, проверка характеристик, стоп-лист одним касанием", async () => {
    const t = setup();
    await openShop(t);
    const created = await t.call("POST", "/api/admin/products", {
      as: OWNER,
      body: {
        title: "Морс клюквенный",
        price: 40000,
        categoryId: "desserts",
        attributes: { portion: "0,5 л" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ id: "mors-klyukvennyy", sort: 20, available: true });

    const bad = await t.call("POST", "/api/admin/products", {
      as: OWNER,
      body: { title: "Квас", price: 30000, categoryId: "drinks", attributes: { kcal: 9000 } },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.issues).toEqual([{ path: "attributes.kcal", message: "Не больше 5000" }]);

    const noCat = await t.call("POST", "/api/admin/products", {
      as: OWNER,
      body: { title: "Квас", price: 30000, categoryId: "drinks" },
    });
    expect(noCat.json.issues).toEqual([{ path: "categoryId", message: "Нет такой категории" }]);

    const off = await t.call("PATCH", "/api/admin/products/borscht", {
      as: OWNER,
      body: { available: false },
    });
    expect(off.json.available).toBe(false);
    const shop = (await t.call("GET", "/api/shop")).json;
    expect(shop.catalog.products.find((p: { id: string }) => p.id === "borscht").available).toBe(
      false,
    );
  });

  it("выключенная фича пропадает из магазина, данные остаются", async () => {
    const t = setup();
    await openShop(t);
    const settings = (await t.call("GET", "/api/admin/settings", { as: OWNER })).json;
    const r = await t.call("PUT", "/api/admin/settings", {
      as: OWNER,
      body: {
        shop: settings.shop,
        hours: settings.hours,
        features: { discounts: false, badges: true },
        orders: settings.orders,
      },
    });
    expect(r.json.region.currency).toBe("VND");
    const borscht = (await t.call("GET", "/api/shop")).json.catalog.products.find(
      (p: { id: string }) => p.id === "borscht",
    );
    expect(borscht.compareAtPrice).toBeUndefined();
    const admin = (await t.call("GET", "/api/admin/catalog", { as: OWNER })).json;
    expect(admin.products.find((p: { id: string }) => p.id === "borscht").compareAtPrice).toBe(
      100000,
    );

    const withRegion = await t.call("PUT", "/api/admin/settings", {
      as: OWNER,
      body: { ...settings, region: { currency: "RUB" } },
    });
    expect(withRegion.status).toBe(400); // регион из админки не меняется
  });

  it("фото блюда: до 5, порядок сохраняется, первое — главное", async () => {
    const t = setup();
    await openShop(t);
    const photo = (n: number) => ({ url: `/uploads/photo-${n}.webp` });
    const body = { title: "Пельмени", price: 90000, categoryId: "frozen" };
    const created = await t.call("POST", "/api/admin/products", {
      as: OWNER,
      body: { ...body, images: [photo(3), photo(1), photo(2)] },
    });
    expect(created.status).toBe(201);
    expect(created.json.images).toEqual([photo(3), photo(1), photo(2)]);

    const id = created.json.id as string;
    const reordered = await t.call("PUT", `/api/admin/products/${id}`, {
      as: OWNER,
      body: { ...body, images: [photo(2), photo(3)] },
    });
    expect(reordered.json.images).toEqual([photo(2), photo(3)]);
    const inShop = (await t.call("GET", "/api/shop")).json.catalog.products.find(
      (p: { id: string }) => p.id === id,
    );
    expect(inShop.images).toEqual([photo(2), photo(3)]);

    const tooMany = await t.call("PUT", `/api/admin/products/${id}`, {
      as: OWNER,
      body: { ...body, images: [1, 2, 3, 4, 5, 6].map(photo) },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.issues).toEqual([{ path: "images", message: "Не больше 5 фото" }]);

    const none = await t.call("PUT", `/api/admin/products/${id}`, { as: OWNER, body });
    expect(none.json.images).toEqual([]);
  });

  it("ссылка на блюдо: база t.me/<бот>?startapp=, без бота — null", async () => {
    const t = setup();
    await openShop(t);
    const catalog = (await t.call("GET", "/api/admin/catalog", { as: OWNER })).json;
    expect(catalog.dishLink).toEqual({
      base: "https://t.me/pechka_test_bot?startapp=",
      mainAppReady: true,
    });

    t.deps.mainAppReady = async () => false;
    expect(
      (await t.call("GET", "/api/admin/catalog", { as: OWNER })).json.dishLink.mainAppReady,
    ).toBe(false);

    t.deps.botUsername = null; // BOT_MODE=off или вебхук занят
    expect((await t.call("GET", "/api/admin/catalog", { as: OWNER })).json.dishLink).toBeNull();
  });

  it("фото блюда → WebP в UPLOADS_DIR", async () => {
    const t = setup();
    await openShop(t);
    const png = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#b5482a" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "borscht.png", { type: "image/png" }));
    const res = await t.app.request("/api/admin/uploads", {
      method: "POST",
      body: form,
      headers: { authorization: `tma ${t.initData(OWNER)}` },
    });
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^\/uploads\/[\w-]+\.webp$/);
    const file = await t.app.request(url);
    expect(file.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1200, 600]);
  });
});

describe("команда", () => {
  it("по ссылке — сразу в команде, без номера; второй раз ссылка не работает", async () => {
    const t = setup();
    await openShop(t);
    upsertUser(t.deps.db, { id: ANNA, firstName: "Анна" }, NOON); // в боте — middleware
    const { token } = createInvite(t.deps.db, t.env, "courier", OWNER, NOON);
    expect(acceptInvite(t.deps.db, t.env, token, ANNA, NOON)).toEqual({
      role: "courier",
      createdBy: OWNER,
    });
    expect(rolesOf(t.deps.db, t.env, ANNA)).toEqual(["courier"]);
    expect(() => acceptInvite(t.deps.db, t.env, token, 777, NOON)).toThrow(/устарела/);
    const late = createInvite(t.deps.db, t.env, "manager", OWNER, NOON);
    const dayLater = new Date(NOON.getTime() + 25 * 3600_000);
    expect(() => acceptInvite(t.deps.db, t.env, late.token, ANNA, dayLater)).toThrow(/устарела/);
  });

  it("приглашение — ссылка на бота, роль владельца не выдать", async () => {
    const t = setup();
    await openShop(t);
    const inv = await t.call("POST", "/api/admin/team/invites", {
      as: OWNER,
      body: { role: "courier" },
    });
    expect(inv.json.link).toMatch(/^https:\/\/t\.me\/pechka_test_bot\?start=inv_[\w-]{20,}$/);
    expect(
      (await t.call("POST", "/api/admin/team/invites", { as: OWNER, body: { role: "owner" } }))
        .status,
    ).toBe(400);
    const team = (await t.call("GET", "/api/admin/team", { as: OWNER })).json.members;
    expect(team).toEqual([
      expect.objectContaining({ id: OWNER, roles: ["owner", "courier"], active: true }),
    ]);
    const r = await t.call("PATCH", `/api/admin/team/${OWNER}`, { as: OWNER, body: { roles: [] } });
    expect(r.json.roles).toEqual(["owner"]); // владелец снял с себя курьера
    expect(
      (await t.call("PATCH", `/api/admin/team/${OWNER}`, { as: OWNER, body: { active: false } }))
        .status,
    ).toBe(409);
  });
});

describe("вход на компьютере", () => {
  it("одноразовая ссылка → cookie; повторно ссылка не работает; чужой сайт не отправит форму", async () => {
    const t = setup();
    await openShop(t);
    const token = createLoginToken(t.deps.db, t.env, OWNER, NOON);
    const login = await t.call("POST", "/api/auth/login", { body: { token } });
    expect(login.status).toBe(200);
    const cookie = login.res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/sid=.+HttpOnly/);
    const sid = cookie.split(";")[0] ?? "";

    const catalog = await t.call("GET", "/api/admin/catalog", { headers: { cookie: sid } });
    expect(catalog.status).toBe(200);
    expect((await t.call("POST", "/api/auth/login", { body: { token } })).status).toBe(401);

    const evil = await t.app.request("/api/admin/categories", {
      method: "POST",
      headers: {
        cookie: sid,
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "title=x",
    });
    expect(evil.status).toBe(403);

    t.clock.now = new Date(NOON.getTime() + 31 * 24 * 60 * 60_000);
    expect((await t.call("GET", "/api/admin/catalog", { headers: { cookie: sid } })).status).toBe(
      401,
    );
    expect(PUBLIC_URL).toBe("https://shop.example");
  });

  it("ссылка живёт 5 минут", async () => {
    const t = setup();
    const token = createLoginToken(t.deps.db, t.env, OWNER, NOON);
    t.clock.now = new Date(NOON.getTime() + 5 * 60_000 + 1);
    expect((await t.call("POST", "/api/auth/login", { body: { token } })).status).toBe(401);
  });
});

describe("короткие ссылки Google Maps", () => {
  it("идём по перенаправлениям только внутри Google", async () => {
    const t = setup();
    t.redirects.set(
      "https://maps.app.goo.gl/abc123",
      "https://www.google.com/maps/place/Hoi+An/@15.87,108.33,17z/data=!3d15.8801!4d108.338",
    );
    const ok = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://maps.app.goo.gl/abc123")}`,
      {
        as: ANNA,
      },
    );
    expect(ok.json).toEqual({ point: { lat: 15.8801, lng: 108.338 }, label: "Hoi An" });

    t.redirects.set("https://maps.app.goo.gl/evil", "http://169.254.169.254/latest/meta-data");
    const evil = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://maps.app.goo.gl/evil")}`,
      {
        as: ANNA,
      },
    );
    expect(evil.status).toBe(422);
    expect(t.fetchCalls).not.toContain("http://169.254.169.254/latest/meta-data");

    const notShort = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://example.com/x")}`,
      {
        as: ANNA,
      },
    );
    expect(notShort.status).toBe(400);
  });

  it("Apple Maps: короткая ссылка → страница места → координаты и название", async () => {
    const t = setup();
    t.redirects.set(
      "https://maps.apple/p/EoH2bXiuMFPqgK",
      "https://maps.apple.com/place?place-id=IFEA9459921CAA709&_provider=9902",
    );
    t.pages.set(
      "https://maps.apple.com/place?place-id=IFEA9459921CAA709&_provider=9902",
      '<html><head><meta property="place:location:latitude" content="16.0680424">' +
        '<meta property="place:location:longitude" content="108.2143557">' +
        '<meta property="og:title" content="Con Market &amp; Co"></head></html>',
    );
    const res = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://maps.apple/p/EoH2bXiuMFPqgK")}`,
      { as: ANNA },
    );
    expect(res.json).toEqual({
      point: { lat: 16.0680424, lng: 108.2143557 },
      label: "Con Market & Co",
    });

    t.redirects.set("https://maps.apple/p/evil", "https://evil.example/place");
    const evil = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://maps.apple/p/evil")}`,
      { as: ANNA },
    );
    expect(evil.status).toBe(422);
    expect(t.fetchCalls).not.toContain("https://evil.example/place");
  });

  it("Google: название места из раскрытой ссылки", async () => {
    const t = setup();
    t.redirects.set(
      "https://maps.app.goo.gl/named",
      "https://www.google.com/maps/place/Con+Market/@16.06,108.21,17z/data=!3d16.068!4d108.2143",
    );
    const res = await t.call(
      "GET",
      `/api/geo/resolve?url=${encodeURIComponent("https://maps.app.goo.gl/named")}`,
      { as: ANNA },
    );
    expect(res.json).toEqual({ point: { lat: 16.068, lng: 108.2143 }, label: "Con Market" });
  });
});

describe("кеш статики", () => {
  it("API не кешируется заголовком статики", async () => {
    const t = setup();
    const res = await t.app.request("/api/health");
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
