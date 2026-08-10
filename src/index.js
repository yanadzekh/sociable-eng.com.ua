export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env);
    }

    if (url.pathname === "/api/track-anketa" && request.method === "POST") {
      return handleTrackAnketa(request, env);
    }

    // Все інше — статичні файли з папки public/
    return env.ASSETS.fetch(request);
  },
};

// ---------- Подія 1: нова заявка з форми ----------
async function handleSubmit(request, env) {
  const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

  let data;
  try {
    data = await request.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Некоректний формат запиту" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  // Honeypot: якщо приховане поле заповнене — це бот.
  if (data.website) {
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }

  const name = (data.name || "").toString().trim();
  const phone = (data.phone || "").toString().trim();
  const format = (data.format || "").toString().trim();
  const comment = (data.comment || "").toString().trim();

  if (!name || !phone) {
    return new Response(
      JSON.stringify({ ok: false, error: "Вкажіть ім'я та телефон" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const charsError = validateChars(name, phone);
  if (charsError) {
    return new Response(JSON.stringify({ ok: false, error: charsError }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const lead = { name, phone, format, comment };

  const channelStatus = await sendAllChannels(lead, "lead", env);
  const anySucceeded = Object.values(channelStatus).some((c) => c.ok);

  if (!anySucceeded) {
    return new Response(
      JSON.stringify({ ok: false, error: "Не вдалося надіслати заявку жодним каналом", channels: channelStatus }),
      { status: 502, headers: jsonHeaders }
    );
  }

  return new Response(JSON.stringify({ ok: true, channels: channelStatus }), { headers: jsonHeaders });
}

// ---------- Подія 2: клієнт перейшов до анкети ----------
async function handleTrackAnketa(request, env) {
  const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

  let data;
  try {
    data = await request.json();
  } catch (err) {
    data = {};
  }

  const name = (data.name || "").toString().trim();
  const phone = (data.phone || "").toString().trim();
  const format = (data.format || "").toString().trim();
  const comment = (data.comment || "").toString().trim();

  // Дані тут не обов'язкові (можуть бути відсутні, якщо не вдалось зберегти
  // на клієнті), але якщо вони є — перевіряємо ті самі символи.
  if (name || phone) {
    const charsError = validateChars(name || "Х", phone || "1");
    if (charsError) {
      return new Response(JSON.stringify({ ok: false, error: charsError }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
  }

  const lead = { name: name || "не вказано", phone: phone || "не вказано", format, comment };

  const channelStatus = await sendAllChannels(lead, "anketa_click", env);
  const anySucceeded = Object.values(channelStatus).some((c) => c.ok);

  // Ця подія не критична для користувача (він все одно вже переходить в анкету),
  // тож завжди повертаємо ok:true, навіть якщо всі канали впали.
  return new Response(JSON.stringify({ ok: true, tracked: anySucceeded, channels: channelStatus }), {
    headers: jsonHeaders,
  });
}

function validateChars(name, phone) {
  const nameValidChars = /^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ\s'’-]+$/;
  const phoneValidChars = /^[0-9+\-() @A-Za-z_]+$/;

  if (!nameValidChars.test(name)) {
    return "Ім'я містить неприпустимі символи";
  }
  if (!phoneValidChars.test(phone)) {
    return "Телефон/Telegram містить неприпустимі символи";
  }
  return null;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------- Надсилання у всі три канали ПАРАЛЕЛЬНО ----------
async function sendAllChannels(lead, stage, env) {
  const results = await Promise.allSettled([
    sendTelegram(lead, stage, env),
    sendGoogleSheets(lead, stage, env),
    sendResend(lead, stage, env),
  ]);

  const [telegramResult, sheetsResult, resendResult] = results;

  return {
    telegram: describeResult(telegramResult),
    googleSheets: describeResult(sheetsResult),
    email: describeResult(resendResult),
  };
}

function describeResult(settledResult) {
  if (settledResult.status === "fulfilled") {
    return settledResult.value;
  }
  return { ok: false, error: settledResult.reason ? String(settledResult.reason.message || settledResult.reason) : "Невідома помилка" };
}

function stageLabel(stage) {
  return stage === "anketa_click"
    ? { emoji: "✅", title: "Клієнт перейшов до анкети", subject: "Клієнт перейшов до анкети — Sociable.eng" }
    : { emoji: "📩", title: "Нова заявка з сайту Sociable.eng", subject: "Нова заявка з сайту Sociable.eng" };
}

// ---------- Канал 1: Telegram-бот ----------
async function sendTelegram(lead, stage, env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не налаштовано" };
  }

  const label = stageLabel(stage);
  const text =
    `${label.emoji} ${label.title}\n\n` +
    `👤 Ім'я: ${lead.name}\n` +
    `📞 Телефон/Telegram: ${lead.phone}\n` +
    `🎯 Формат: ${lead.format || "не вказано"}\n` +
    `💬 Коментар: ${lead.comment || "—"}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.ok !== true) {
      const detail = data && data.description ? data.description : `HTTP ${res.status}`;
      return { ok: false, error: `Telegram: ${detail}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Telegram: мережева помилка (${err && err.message ? err.message : err})` };
  }
}

// ---------- Канал 2: Google Таблиця (через Google Apps Script Web App) ----------
async function sendGoogleSheets(lead, stage, env) {
  const webhookUrl = env.GOOGLE_SHEETS_WEBHOOK_URL;

  if (!webhookUrl) {
    return { ok: false, error: "GOOGLE_SHEETS_WEBHOOK_URL не налаштовано" };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: stage, // "lead" (нова заявка) або "anketa_click" (перехід до анкети)
        name: lead.name,
        phone: lead.phone,
        format: lead.format,
        comment: lead.comment,
        source: "sociable-eng.com.ua",
      }),
      redirect: "follow",
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { ok: false, error: `Google Sheets: HTTP ${res.status} ${bodyText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Google Sheets: мережева помилка (${err && err.message ? err.message : err})` };
  }
}

// ---------- Канал 3: Email через Resend ----------
// Лист шле з "onboarding@resend.dev" (стандартна тестова адреса Resend,
// не потребує підтвердження власного домену) на RESEND_TO_EMAIL.
// Коли буде свій домен на Cloudflare — можна верифікувати його в Resend
// і надсилати з красивішої адреси (наприклад, leads@sociable-eng.com.ua).
async function sendResend(lead, stage, env) {
  const apiKey = env.RESEND_API_KEY;
  const toEmail = env.RESEND_TO_EMAIL;

  if (!apiKey || !toEmail) {
    return { ok: false, error: "RESEND_API_KEY / RESEND_TO_EMAIL не налаштовано" };
  }

  const label = stageLabel(stage);
  const html = `
    <h2>${label.emoji} ${escapeHtml(label.title)}</h2>
    <p><b>Ім'я:</b> ${escapeHtml(lead.name)}</p>
    <p><b>Телефон/Telegram:</b> ${escapeHtml(lead.phone)}</p>
    <p><b>Формат:</b> ${escapeHtml(lead.format || "не вказано")}</p>
    <p><b>Коментар:</b> ${escapeHtml(lead.comment || "—")}</p>
  `.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Sociable.eng <onboarding@resend.dev>",
        to: [toEmail],
        subject: label.subject,
        html,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { ok: false, error: `Resend: HTTP ${res.status} ${bodyText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Resend: мережева помилка (${err && err.message ? err.message : err})` };
  }
}
