import type { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { syncBotProfile } from "../src/bot/profile.ts";
import { OWNER, SETUP_BODY, setup } from "./helpers.ts";

function fakeApi(current: { name: string; description: string; short: string }) {
  const sets: string[] = [];
  const api = {
    getMyName: async () => ({ name: current.name }),
    getMyDescription: async () => ({ description: current.description }),
    getMyShortDescription: async () => ({ short_description: current.short }),
    setMyName: async (v: string) => sets.push(`name:${v}`),
    setMyDescription: async (v: string) => sets.push(`description:${v.split("\n")[0]}`),
    setMyShortDescription: async (v: string) => sets.push(`short:${v}`),
  };
  return { api: api as unknown as Api, sets };
}

describe("профиль бота из настроек", () => {
  it("до настройки магазина ничего не трогает", async () => {
    const t = setup();
    const { api, sets } = fakeApi({ name: "@old", description: "", short: "" });
    await syncBotProfile(api, t.deps);
    expect(sets).toEqual([]);
  });

  it("ставит имя и описания, меняет только отличающееся", async () => {
    const t = setup();
    await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY });
    const shop = (await t.call("GET", "/api/admin/settings", { as: OWNER })).json.shop;

    const fresh = fakeApi({ name: "@pechka_hoian", description: "", short: "" });
    await syncBotProfile(fresh.api, t.deps);
    expect(fresh.sets).toEqual([
      "name:Печка",
      "description:Закажите еду с доставкой прямо в Telegram.",
      `short:${shop.botAbout}`,
    ]);

    const same = fakeApi({ name: "Печка", description: shop.botDescription, short: "x" });
    await syncBotProfile(same.api, t.deps);
    expect(same.sets).toEqual([`short:${shop.botAbout}`]);
  });
});
