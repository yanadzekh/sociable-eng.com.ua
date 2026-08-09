# Sociable.eng — сайт (Cloudflare Worker + static assets)

## Структура

```
public/           статичні файли сайту (те, що бачить браузер)
  index.html
  assets/logo.jpg
src/index.js       Worker-скрипт: обробляє /api/submit, решту віддає зі static assets
wrangler.toml       конфігурація Worker-а (вхідний скрипт + папка assets)
```

## Перший деплой (через GitHub, без термінала)

Якщо репозиторій уже підключений до Cloudflare Worker у Dashboard:

1. Завантажте всі файли з цього архіву в репозиторій **у такій самій структурі**
   (папки `public/`, `src/`, файл `wrangler.toml` — у корені репозиторію).
2. Cloudflare підхопить зміни й автоматично передеплоїть проєкт
   (або натисніть **New deployment** у Dashboard вручну).
3. Після деплою відкрийте **Settings → Variables and secrets** —
   обмеження "static assets" зникне, з'явиться кнопка **Add variable**.

## Додавання змінної FORMSUBMIT_EMAIL

1. Workers & Pages → sociable-eng-com-ua → **Settings → Variables and secrets**.
2. **Add variable** → Name: `FORMSUBMIT_EMAIL`, Value: `yanachitsyana@gmail.com`.
3. Тип — **Plaintext** (можна Secret, якщо хочете приховати значення в інтерфейсі).
4. **Save**, за потреби запустіть **New deployment**, щоб зміна набула чинності.

## Як працює форма

1. Відвідувач заповнює форму на сайті → JS відправляє `POST /api/submit` з JSON.
2. Worker (`src/index.js`) перевіряє honeypot-поле (`website`) —
   якщо воно заповнене, це бот, і лист не надсилається.
3. Якщо все ок — Worker пересилає дані на **FormSubmit.co**
   (безкоштовний сервіс, лист приходить на `FORMSUBMIT_EMAIL`, API-ключ не потрібен).
4. **Важливо:** при першому листі FormSubmit попросить підтвердити email
   (лист із посиланням "Confirm your email now"). Це одноразова дія —
   після підтвердження наступні заявки приходитимуть без додаткових кроків.

## Локальна перевірка (опційно, якщо є Node.js)

```bash
npm install -g wrangler
wrangler dev
```

Відкриє сайт на `localhost:8787` із робочим `/api/submit`
(змінну `FORMSUBMIT_EMAIL` для локального тесту можна додати у файл `.dev.vars`:
`FORMSUBMIT_EMAIL=yanachitsyana@gmail.com`).
