import { describe, expect, it, vi } from "vitest";
import { mainAppCheck } from "../src/bot/main-app.ts";

describe("Main Mini App у бота", () => {
  it("getMe не чаще раза в минуту, новое значение — после минуты", async () => {
    let clock = 0;
    let enabled = false;
    const getMe = vi.fn(async () => enabled);
    const check = mainAppCheck(getMe, () => clock);

    expect(await check()).toBe(false);
    enabled = true; // включили в BotFather
    clock = 59_000;
    expect(await check()).toBe(false);
    expect(getMe).toHaveBeenCalledTimes(1);

    clock = 60_000;
    expect(await check()).toBe(true);
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it("Telegram не ответил — прошлое значение, без исключения", async () => {
    let clock = 0;
    let fail = false;
    const check = mainAppCheck(
      async () => {
        if (fail) throw new Error("timeout");
        return true;
      },
      () => clock,
    );
    expect(await check()).toBe(true);
    fail = true;
    clock = 120_000;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await check()).toBe(true);
  });
});
