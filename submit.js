// Cloudflare Pages Function: /api/submit
// Приймає заявку з форми на сайті й розсилає її одразу на 3 канали:
//   1. Telegram-бот
//   2. Google Таблиця (через Google Apps Script Web App)
//   3. FormSubmit (email)
//
// Жоден канал не блокує інші — якщо один впаде, решта все одно спрацюють.
//
// ЗМІННІ СЕРЕДОВИЩА (Cloudflare Pages → Settings → Environment variables):
//   TELEGRAM_BOT_TOKEN         — токен бота від @BotFather
//   TELEGRAM_CHAT_ID           — ID чату/групи для заявок
//   GOOGLE_SHEETS_WEBHOOK_URL  — URL Google Apps Script Web App (див. README)
//   FORMSUBMIT_EMAIL           — email, на який FormSubmit надсилатиме заявки
//
// Кожен канал вмикається лише якщо відповідні змінні задані — можна підключати поступово.

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();

    const name = (data.name || '').toString().trim().slice(0, 200);
    const phone = (data.phone || '').toString().trim().slice(0, 200);
    const format = (data.format || '').toString().trim().slice(0, 200);
    const comment = (data.comment || '').toString().trim().slice(0, 1000);
    const source = (data.source || 'сайт').toString().trim().slice(0, 200);

    if (!name || !phone) {
      return json({ ok: false, error: 'missing_fields' }, 400);
    }

    // Базова серверна перевірка символів (дублює клієнтську валідацію на випадок обходу форми)
    const namePattern = /^[\p{L}\s'’ʼ-]{1,200}$/u;
    const phonePattern = /^[0-9+\-() a-zA-Zа-яА-ЯіІїЇєЄґҐ@_.]{1,200}$/;
    if (!namePattern.test(name) || !phonePattern.test(phone)) {
      return json({ ok: false, error: 'invalid_characters' }, 400);
    }

    const lead = { name, phone, format, comment, source, timestamp: new Date().toISOString() };
    const tasks = [];
    const channels = [];

    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      channels.push('telegram');
      tasks.push(sendToTelegram(env, lead));
    }
    if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
      channels.push('google_sheets');
      tasks.push(sendToGoogleSheets(env, lead));
    }
    if (env.FORMSUBMIT_EMAIL) {
      channels.push('formsubmit');
      tasks.push(sendToFormSubmit(env, lead));
    }

    if (tasks.length === 0) {
      return json({ ok: false, error: 'no_channels_configured' }, 500);
    }

    const results = await Promise.allSettled(tasks);
    const report = channels.map((name, i) => ({
      channel: name,
      ok: results[i].status === 'fulfilled',
    }));
    const anySuccess = report.some((r) => r.ok);

    if (!anySuccess) {
      return json({ ok: false, error: 'all_channels_failed', report }, 502);
    }

    return json({ ok: true, report }, 200);
  } catch (err) {
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- 1. Telegram ---
async function sendToTelegram(env, lead) {
  const text =
    `📩 Нова заявка — Sociable.eng\n\n` +
    `👤 Ім'я: ${lead.name}\n` +
    `📞 Контакт: ${lead.phone}\n` +
    `📚 Формат: ${lead.format || '—'}\n` +
    (lead.comment ? `💬 Коментар: ${lead.comment}\n` : '') +
    `🌐 Джерело: ${lead.source}`;

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) throw new Error('telegram_failed: ' + (await res.text()));
  return true;
}

// --- 2. Google Таблиця (через Apps Script Web App, див. README) ---
async function sendToGoogleSheets(env, lead) {
  const res = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
  });
  if (!res.ok) throw new Error('google_sheets_failed: ' + (await res.text()));
  return true;
}

// --- 3. FormSubmit (email) ---
async function sendToFormSubmit(env, lead) {
  const res = await fetch(`https://formsubmit.co/ajax/${env.FORMSUBMIT_EMAIL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      "Ім'я": lead.name,
      Контакт: lead.phone,
      Формат: lead.format || '—',
      Коментар: lead.comment || '—',
      Джерело: lead.source,
      _subject: `Нова заявка Sociable.eng — ${lead.name}`,
    }),
  });
  if (!res.ok) throw new Error('formsubmit_failed: ' + (await res.text()));
  return true;
}
