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

// ---------- Надсилання у всі три канали ПАРАЛЕЛЬНО ----------
async function sendAllChannels(lead, stage, env) {
  const results = await Promise.allSettled([
    sendTelegram(lead, stage, env),
    sendGoogleSheets(lead, stage, env),
    sendFormSubmit(lead, stage, env),
  ]);

  const [telegramResult, sheetsResult, formSubmitResult] = results;

  return {
    telegram: describeResult(telegramResult),
    googleSheets: describeResult(sheetsResult),
    formSubmit: describeResult(formSubmitResult),
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

  const label = stageLabel(stage);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        status: label.title,
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

// ---------- Канал 3: FormSubmit (email) ----------
async function sendFormSubmit(lead, stage, env) {
  const targetEmail = env.FORMSUBMIT_EMAIL;

  if (!targetEmail) {
    return { ok: false, error: "FORMSUBMIT_EMAIL не налаштовано" };
  }

  const label = stageLabel(stage);

  try {
    const fsData = new FormData();
    fsData.append("Статус", label.title);
    fsData.append("Ім'я", lead.name);
    fsData.append("Телефон / Telegram", lead.phone);
    fsData.append("Формат", lead.format || "не вказано");
    fsData.append("Коментар", lead.comment || "—");
    fsData.append("_subject", label.subject);
    fsData.append("_template", "table");
    fsData.append("_captcha", "false");

    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: fsData,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { ok: false, error: `FormSubmit: HTTP ${res.status} ${bodyText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `FormSubmit: мережева помилка (${err && err.message ? err.message : err})` };
  }
}
