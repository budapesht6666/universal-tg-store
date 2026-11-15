/**
 * Бот: /start (меню, первая настройка, приглашение в команду), /login (вход на компьютере),
 * кнопки в уведомлениях («Принять», «Забрал, еду», «Доставлен») и переписка покупателя
 * с магазином: сообщение покупателя уходит менеджерам, ответ менеджера — покупателю.
 * Писать можно только по заказу в работе (и сутки после него) — иначе бот вежливо отказывает.
 */
import { can, normalizePhone, type StaffOrderActionName } from "@store/schema";
import { and, eq } from "drizzle-orm";
import { Bot, type Context, InlineKeyboard, Keyboard } from "grammy";
import { botMessages, orders } from "../db/schema.ts";
import type { Deps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { chatOrder, staffAction } from "../orders/service.ts";
import { getShop } from "../repo/settings.ts";
import {
  claimInvite,
  completeInvite,
  createLoginToken,
  displayName,
  rolesOf,
  staffWith,
  upsertUser,
} from "../repo/team.ts";
import { rememberRelay } from "./notifier.ts";
import { esc, roleLabel, shopAppUrl, staffAppUrl, webAppButton } from "./texts.ts";

const CUSTOMER_COMMANDS = [{ command: "start", description: "Меню и как заказать" }];
const LOGIN_COMMAND = { command: "login", description: "Админка на компьютере" };

/** Автоответ без заказа — не чаще раза в минуту одному человеку (поток сообщений не плодит ответы). */
const NO_ORDER_REPLY_EVERY_MS = 60 * 1000;

const CALLBACK_ACTIONS: Record<string, StaffOrderActionName> = {
  a: "accept",
  p: "pickup",
  d: "deliver",
};

/**
 * Чат сотрудника: кнопка меню «Заказы» (у покупателей — общая «Меню», ставится при запуске)
 * и /login в списке команд у тех, кому доступна админка.
 */
async function setStaffMenuButton(ctx: Context, deps: Deps) {
  if (!ctx.chat || !ctx.from) return;
  const roles = rolesOf(deps.db, deps.env, ctx.from.id);
  if (can(roles, "catalog.manage") || can(roles, "settings.manage")) {
    await ctx.api
      .setMyCommands([...CUSTOMER_COMMANDS, LOGIN_COMMAND], {
        scope: { type: "chat", chat_id: ctx.chat.id },
      })
      .catch(() => {});
  }
  if (!deps.env.WEB_APP_ENABLED) return;
  await ctx.api
    .setChatMenuButton({
      chat_id: ctx.chat.id,
      menu_button: { type: "web_app", text: "Заказы", web_app: { url: staffAppUrl(deps.env) } },
    })
    .catch(() => {});
}

export function createBot(deps: Deps): Bot {
  const { db, env } = deps;
  const bot = new Bot(env.BOT_TOKEN);
  const pm = bot.chatType("private");
  const noOrderRepliedAt = new Map<number, number>();

  pm.use(async (ctx, next) => {
    upsertUser(
      db,
      {
        id: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      },
      deps.now(),
    );
    await next();
  });

  pm.command("start", async (ctx) => {
    const payload = ctx.match.trim();

    if (payload.startsWith("inv_")) {
      try {
        const role = claimInvite(db, env, payload.slice(4), ctx.from.id, deps.now());
        const shopName = getShop(db)?.settings.shop.name ?? "магазин";
        await ctx.reply(
          `Вас приглашают в «${esc(shopName)}» — ${roleLabel(role)}.\nПоделитесь номером: по нему с вами свяжутся по заказам.`,
          {
            parse_mode: "HTML",
            reply_markup: new Keyboard()
              .requestContact("📱 Поделиться номером")
              .oneTime()
              .resized(),
          },
        );
      } catch (err) {
        await ctx.reply(
          err instanceof AppError ? err.message : "Не получилось открыть приглашение",
        );
      }
      return;
    }

    const shop = getShop(db);
    const roles = rolesOf(db, env, ctx.from.id);
    if (!shop) {
      if (ctx.from.id === env.OWNER_TELEGRAM_ID) {
        await ctx.reply("Привет! Магазин ещё не настроен — это три шага, пара минут.", {
          reply_markup: webAppButton(
            new InlineKeyboard(),
            env,
            "Настроить магазин",
            staffAppUrl(env, "setup"),
          ),
        });
      } else {
        await ctx.reply("Магазин скоро откроется. Загляните чуть позже!");
      }
      return;
    }

    const kb = webAppButton(new InlineKeyboard(), env, "Меню", shopAppUrl(env));
    if (roles.length > 0) {
      webAppButton(kb.row(), env, "Заказы", staffAppUrl(env));
      await setStaffMenuButton(ctx, deps);
    }
    await ctx.reply(esc(shop.settings.shop.greeting), { parse_mode: "HTML", reply_markup: kb });
  });

  pm.command("login", async (ctx) => {
    const roles = rolesOf(db, env, ctx.from.id);
    if (!can(roles, "catalog.manage") && !can(roles, "settings.manage")) {
      await ctx.reply("Вход в админку — для владельца и менеджеров.");
      return;
    }
    const token = createLoginToken(db, env, ctx.from.id, deps.now());
    const url = `${env.PUBLIC_URL}/admin/login#${token}`;
    await ctx.reply(
      `Ссылка для входа в админку на компьютере — действует 5 минут, один раз:\n${esc(url)}\n\nНикому её не пересылайте.`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  pm.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply("Отправьте свой номер кнопкой ниже.");
      return;
    }
    const code = getShop(db)?.settings.region.phoneCode ?? "84";
    const phone =
      normalizePhone(contact.phone_number, code) ?? `+${contact.phone_number.replace(/\D/g, "")}`;
    const joined = completeInvite(db, ctx.from.id, phone, deps.now());
    if (!joined) {
      await ctx.reply("Спасибо!", { reply_markup: { remove_keyboard: true } });
      return;
    }
    await ctx.reply(
      `Готово, вы в команде — ${roleLabel(joined.role)}. Заказы — кнопка «Заказы» внизу.`,
      {
        reply_markup: { remove_keyboard: true },
      },
    );
    await setStaffMenuButton(ctx, deps);
    await ctx.api
      .sendMessage(
        joined.createdBy,
        `👋 ${esc(displayName({ firstName: ctx.from.first_name, lastName: ctx.from.last_name ?? null }))} в команде — ${roleLabel(joined.role)}`,
        {
          parse_mode: "HTML",
          disable_notification: true,
        },
      )
      .catch(() => {});
  });

  bot.callbackQuery(/^([apd]):(\d+)$/, async (ctx) => {
    const action = CALLBACK_ACTIONS[ctx.match[1] ?? ""];
    const orderId = Number(ctx.match[2]);
    if (!action || action === "assign" || action === "fail" || action === "cancel") return;
    try {
      staffAction(deps, { id: ctx.from.id, roles: rolesOf(db, env, ctx.from.id) }, orderId, {
        action,
      });
      await ctx.answerCallbackQuery({ text: "Готово" });
    } catch (err) {
      await ctx.answerCallbackQuery({
        text: err instanceof AppError ? err.message : "Не получилось — откройте заказ в приложении",
        show_alert: true,
      });
    }
  });

  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());

  // Переписка: всё остальное в личке с ботом.
  pm.on("message", async (ctx) => {
    if (ctx.message.text?.startsWith("/")) return;
    const roles = rolesOf(db, env, ctx.from.id);

    if (roles.length > 0) {
      const replyTo = ctx.message.reply_to_message?.message_id;
      const target = replyTo
        ? db
            .select()
            .from(botMessages)
            .where(and(eq(botMessages.chatId, ctx.chat.id), eq(botMessages.messageId, replyTo)))
            .get()
        : undefined;
      let customerId = target?.customerId ?? null;
      if (target && customerId === null && target.orderId !== null) {
        customerId =
          db.select().from(orders).where(eq(orders.id, target.orderId)).get()?.customerId ?? null;
      }
      if (customerId === null) {
        await ctx.reply(
          "Чтобы ответить покупателю, ответьте на его сообщение или на сообщение о заказе (свайп влево).",
        );
        return;
      }
      try {
        await ctx.api.copyMessage(customerId, ctx.chat.id, ctx.message.message_id);
        await ctx.react("👌").catch(() => {});
      } catch {
        await ctx.reply("Не доставлено: покупатель остановил бота.");
      }
      return;
    }

    const shop = getShop(db);
    if (!shop) return;
    const lastOrder = chatOrder(db, ctx.from.id);
    if (!lastOrder) {
      // Без заказа менеджерам не пишем — иначе бот превращается в канал для спама.
      const now = deps.now().getTime();
      const last = noOrderRepliedAt.get(ctx.from.id);
      if (last !== undefined && now - last < NO_ORDER_REPLY_EVERY_MS) return;
      noOrderRepliedAt.set(ctx.from.id, now);
      const { manager } = shop.settings.shop;
      await ctx.reply(
        [
          "Здравствуйте! Этот чат — для вопросов по заказу в работе, остальные сообщения менеджер здесь не получает.",
          manager
            ? `По другим вопросам напишите менеджеру: @${esc(manager)} — ответит в рабочее время, как только освободится.`
            : null,
          "Сделать заказ — кнопка «Меню» внизу.",
        ]
          .filter(Boolean)
          .join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    const who = [
      `💬 <b>${esc(displayName({ firstName: ctx.from.first_name, lastName: ctx.from.last_name ?? null }))}</b>`,
      ctx.from.username ? `@${esc(ctx.from.username)}` : null,
      `заказ #${lastOrder.id}`,
    ]
      .filter(Boolean)
      .join(" · ");
    for (const m of staffWith(db, env, "orders.manage")) {
      try {
        const head = await ctx.api.sendMessage(
          m.id,
          `${who}\n<i>Ответьте на сообщение — бот перешлёт покупателю</i>`,
          {
            parse_mode: "HTML",
          },
        );
        rememberRelay(deps, m.id, head.message_id, ctx.from.id, lastOrder.id);
        const copy = await ctx.api.copyMessage(m.id, ctx.chat.id, ctx.message.message_id, {
          disable_notification: true,
        });
        rememberRelay(deps, m.id, copy.message_id, ctx.from.id, lastOrder.id);
      } catch (err) {
        console.error(`Бот: не переслалось сообщение менеджеру ${m.id}:`, String(err));
      }
    }
    await ctx.react("👌").catch(() => {});
  });

  bot.catch((err) => console.error("Бот:", err.error));
  return bot;
}

/** Общая кнопка меню «Меню» и список команд — при запуске. */
export async function setupBotUi(bot: Bot, deps: Deps): Promise<void> {
  await bot.api.setMyCommands(CUSTOMER_COMMANDS);
  if (!deps.env.WEB_APP_ENABLED) {
    console.warn(
      "PUBLIC_URL без https: бот работает, но кнопок Mini App нет. Для них нужен https-адрес (туннель).",
    );
    return;
  }
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Меню", web_app: { url: shopAppUrl(deps.env) } },
  });
}
