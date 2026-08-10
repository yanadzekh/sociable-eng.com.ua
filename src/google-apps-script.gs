/**
 * Google Apps Script — приймає заявки та події з сайту Sociable.eng
 * і дописує їх рядком у Google Таблицю.
 *
 * ЯК ПІДКЛЮЧИТИ:
 * 1. Створіть нову Google Таблицю (sheets.google.com).
 * 2. У ній: Розширення → Apps Script.
 * 3. Видаліть весь код-заглушку, вставте замість нього весь цей файл.
 * 4. Збережіть (Ctrl+S / Cmd+S), назвіть проєкт як завгодно.
 * 5. Натисніть "Розгорнути" (Deploy) → "Нове розгортання" (New deployment).
 * 6. Тип — "Веб-застосунок" (Web app).
 *    - Execute as: Me (ваш акаунт)
 *    - Who has access: Anyone (обов'язково — інакше Worker не зможе достукатись)
 * 7. Натисніть Deploy, дозвольте доступ (авторизуйтесь Google-акаунтом).
 * 8. Скопіюйте URL веб-застосунку (закінчується на /exec) —
 *    це і є GOOGLE_SHEETS_WEBHOOK_URL для Cloudflare.
 *
 * ЯКЩО ТАБЛИЦЯ ВЖЕ ІСНУЄ (оновлення з попередньої версії):
 * Просто замініть код на цей і зробіть "Нове розгортання" ще раз —
 * додасться нова колонка "Статус" для нових рядків.
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Якщо це перший запис — додаємо заголовки
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Дата", "Статус", "Ім'я", "Телефон/Telegram", "Формат", "Коментар", "Джерело"]);
    }

    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.status || "Нова заявка з сайту Sociable.eng",
      data.name || "",
      data.phone || "",
      data.format || "",
      data.comment || "",
      data.source || "",
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
