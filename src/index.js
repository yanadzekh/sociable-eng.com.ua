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
  // Відповідаємо "успіхом", щоб бот не намагався далі, але лист не надсилаємо.
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

  const targetEmail = env.FORMSUBMIT_EMAIL;
  if (!targetEmail) {
    return new Response(
      JSON.stringify({ ok: false, error: "Email для заявок не налаштовано (FORMSUBMIT_EMAIL)" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  try {
    const fsData = new FormData();
    fsData.append("Ім'я", name);
    fsData.append("Телефон / Telegram", phone);
    fsData.append("Формат", format || "не вказано");
    fsData.append("Коментар", comment || "—");
    fsData.append("_subject", "Нова заявка з сайту Sociable.eng");
    fsData.append("_template", "table");
    fsData.append("_captcha", "false");

    const fsResponse = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: fsData,
    });

    if (!fsResponse.ok) {
      const errText = await fsResponse.text().catch(() => "");
      return new Response(
        JSON.stringify({
          ok: false,
          error: `FormSubmit відповів помилкою ${fsResponse.status}: ${errText.slice(0, 300)}`,
        }),
        { status: 502, headers: jsonHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: `Мережева помилка: ${err && err.message ? err.message : String(err)}` }),
      { status: 502, headers: jsonHeaders }
    );
  }
}
