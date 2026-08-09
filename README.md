# Sociable.eng — сайт-візитка

## Що нового в цій версії

1. **SEO розширено на всю Україну та українців за кордоном** — оновлено meta description, keywords, Open Graph, Twitter Card, Schema.org (`areaServed`, `audience`), заголовок hero-блоку та рядок у контактах.
2. **Заявка з сайту тепер іде на 3 канали одночасно**: Telegram-бот, Google Таблиця, FormSubmit (email). Якщо один канал впаде — інші все одно спрацюють.
3. **Підготовлено місце під Google Search Console + Google Ads + Google Analytics** (закоментовані блоки, готові до вставки реальних ID).
4. **Поля форми "Залишити заявку" фільтрують символи** під час набору — ім'я приймає лише літери/пробіл/апостроф/дефіс, телефон/Telegram — цифри, `+ - ( )`, пробіл або `@нікнейм`.

---

## 1. Налаштування 3 каналів заявки

### Канал 1 — Telegram-бот
Вже описано раніше: створіть бота через [@BotFather](https://t.me/BotFather), додайте його у чат, отримайте `TELEGRAM_BOT_TOKEN` і `TELEGRAM_CHAT_ID` (через `https://api.telegram.org/bot<TOKEN>/getUpdates`).

### Канал 2 — Google Таблиця
Google Таблиці не приймають запити напряму — потрібен маленький "міст" через Google Apps Script:

1. Створіть нову Google Таблицю для заявок (наприклад, з колонками `timestamp | name | phone | format | comment | source`).
2. У таблиці: **Розширення → Apps Script**.
3. Вставте такий код замість того, що там є:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || '',
    data.phone || '',
    data.format || '',
    data.comment || '',
    data.source || ''
  ]);
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. **Розгорнути → New deployment → тип: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Скопіюйте URL веб-застосунку (закінчується на `/exec`) — це і є `GOOGLE_SHEETS_WEBHOOK_URL`.

### Канал 3 — FormSubmit
1. Заявки надсилатимуться на вашу пошту через [formsubmit.co](https://formsubmit.co) — реєстрація не потрібна.
2. Просто вкажіть свою реальну пошту як `FORMSUBMIT_EMAIL`.
3. **Важливо:** перше повідомлення FormSubmit надішле лист із проханням підтвердити цю пошту (одноразово) — без підтвердження наступні заявки не проходитимуть. Тож після першого деплою варто одразу заповнити тестову заявку на сайті й підтвердити пошту.

### Де вписати всі 4 змінні
Cloudflare Dashboard → ваш проєкт → **Settings → Environment variables**:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GOOGLE_SHEETS_WEBHOOK_URL`
- `FORMSUBMIT_EMAIL`

Можна підключати канали поступово — кожен зі скрипту `functions/api/submit.js` вмикається лише якщо відповідна змінна задана.

---

## 2. Google Search Console + Google Ads + Google Analytics (на майбутнє)

Все підготовлено, але не активовано — щоб не заважати, поки немає реальних ID.

**Search Console:**
1. [search.google.com/search-console](https://search.google.com/search-console) → додати домен.
2. Оберіть спосіб верифікації **HTML tag** — отримаєте код на кшталт `content="abc123..."`.
3. У `index.html` розкоментуйте рядок:
   ```html
   <meta name="google-site-verification" content="ВСТАВТЕ_КОД_З_SEARCH_CONSOLE">
   ```
   і вставте свій код.
4. Після деплою натисніть "Verify" в Search Console, потім надішліть `sitemap.xml` (Sitemaps → Add a new sitemap → `sitemap.xml`).

**Google Analytics (GA4):**
1. [analytics.google.com](https://analytics.google.com) → створити ресурс → отримаєте Measurement ID (`G-XXXXXXXXXX`).
2. У `index.html` розкоментуйте блок `gtag.js` у `<head>` і замініть `G-XXXXXXXXXX` на реальний ID.

**Google Ads:**
1. Створіть Conversion Action у Google Ads кабінеті — отримаєте `AW-XXXXXXXXXX/XXXXXXXXX`.
2. Розкоментуйте `gtag('config', 'AW-XXXXXXXXXX')` у тому ж блоці `gtag.js`.
3. У кінці JS-скрипту форми розкоментуйте рядок:
   ```javascript
   // gtag('event', 'conversion', {'send_to': 'AW-XXXXXXXXXX/XXXXXXXXX'});
   ```
   і вставте свій реальний ID/label — так заявки рахуватимуться як конверсії.

---

## 3. Домен

Метатеги, canonical, schema.org і sitemap.xml зараз використовують `sociable-eng.com.ua` як заглушку. Коли буде реальний домен — замінити всюди через пошук-і-заміну.

---

## Деплой на Cloudflare Pages

1. Підключіть GitHub-репозиторій до Cloudflare Pages (Workers & Pages → Create → Pages → Connect to Git).
2. Framework preset — None, build command — порожньо, output directory — `/`.
3. Додайте змінні середовища (див. розділ 1 вище).
4. Підключіть свій домен у Settings → Custom domains.

## Мобільна адаптивність

Перевірено реальним рендером через Playwright на 320px, 375px і десктопі.
