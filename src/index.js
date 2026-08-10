export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Серверний маршрут для форми заявки
    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env);
    }

    // Все інше — статичні файли з папки public/
    return env.ASSETS.fetch(request);
  },
};

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
  // Відповідаємо "успіхом", щоб бот не намагався далі, але нікуди не надсилаємо.
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

  // Дублюємо клієнтську фільтрацію символів на сервері —
  // на випадок, якщо хтось відправляє запит напряму, оминаючи форму.
  const nameValidChars = /^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ\s'’-]+$/;
  const phoneValidChars = /^[0-9+\-() @A-Za-z_]+$/;

  if (!nameValidChars.test(name)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Ім'я містить неприпустимі символи" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  if (!phoneValidChars.test(phone)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Телефон/Telegram містить неприпустимі символи" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const lead = { name, phone, format, comment };

  // Надсилаємо у всі три канали ПАРАЛЕЛЬНО.
  // Кожен канал не залежить від інших: якщо один впаде, решта все одно спрацюють.
  const results = await Promise.allSettled([
    sendTelegram(lead, env),
    sendGoogleSheets(lead, env),
    sendFormSubmit(lead, env),
  ]);

  const [telegramResult, sheetsResult, formSubmitResult] = results;

  const channelStatus = {
    telegram: describeResult(telegramResult),
    googleSheets: describeResult(sheetsResult),
    formSubmit: describeResult(formSubmitResult),
  };

  const anySucceeded = Object.values(channelStatus).some((c) => c.ok);

  if (!anySucceeded) {
    // Усі три канали впали — це справжня проблема, повідомляємо користувача.
    return new Response(
      JSON.stringify({ ok: false, error: "Не вдалося надіслати заявку жодним каналом", channels: channelStatus }),
      { status: 502, headers: jsonHeaders }
    );
  }

  // Хоча б один канал спрацював — для відвідувача це успіх.
  // channelStatus повертаємо для діагностики (можна прибрати пізніше з відповіді).
  return new Response(
    JSON.stringify({ ok: true, channels: channelStatus }),
    { headers: jsonHeaders }
  );
}

function describeResult(settledResult) {
  if (settledResult.status === "fulfilled") {
    return settledResult.value; // { ok: true } або { ok: false, error: "..." }
  }
  return { ok: false, error: settledResult.reason ? String(settledResult.reason.message || settledResult.reason) : "Невідома помилка" };
}

// ---------- Канал 1: Telegram-бот ----------
async function sendTelegram(lead, env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не налаштовано" };
  }

  const text =
    "📩 Нова заявка з сайту Sociable.eng\n\n" +
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
async function sendGoogleSheets(lead, env) {
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
async function sendFormSubmit(lead, env) {
  const targetEmail = env.FORMSUBMIT_EMAIL;

  if (!targetEmail) {
    return { ok: false, error: "FORMSUBMIT_EMAIL не налаштовано" };
  }

  try {
    const fsData = new FormData();
    fsData.append("Ім'я", lead.name);
    fsData.append("Телефон / Telegram", lead.phone);
    fsData.append("Формат", lead.format || "не вказано");
    fsData.append("Коментар", lead.comment || "—");
    fsData.append("_subject", "Нова заявка з сайту Sociable.eng");
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
