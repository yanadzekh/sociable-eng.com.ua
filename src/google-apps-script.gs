/**
 * Google Apps Script — приймає заявки та події з сайту Sociable.eng.
 *
 * Логіка:
 * - Нова заявка (stage = "lead")         → додає новий рядок, Статус = "новий"
 * - Клієнт перейшов до анкети (stage = "anketa_click")
 *     → знаходить існуючий рядок цього клієнта (за телефоном) і
 *       заповнює лише колонку "Статус анкети", НЕ створюючи новий рядок.
 *     → якщо рядок не знайдено (наприклад, дані не збереглись) —
 *       створює новий рядок як запасний варіант.
 *
 * ВИПРАВЛЕННЯ (порівняно з попередньою версією):
 * Google Таблиці автоматично перетворюють номер телефону виду "+380968558031"
 * на ЧИСЛО 380968558031, губ лячи знак "+". Через це порівняння телефонів
 * "у лоб" (rowPhone === phone) ніколи не спрацьовувало, і скрипт щоразу
 * створював новий рядок замість оновлення статусу анкети в існуючому.
 * Тепер телефони порівнюються лише по цифрах (normalizePhoneDigits),
 * а сам номер додатково примусово зберігається як текст, щоб "+" не губився.
 *
 * Колонки (мають співпадати з вашою таблицею):
 * A Дата | B Ім'я | C Телефон | D Формат | E Коментар | F Статус |
 * G Статус анкети | H Джерело | I Наступний контакт | J Відповідальний |
 * K Коментар | L Сума угоди
 *
 * ЯК ОНОВИТИ:
 * У Google Таблиці: Розширення → Apps Script → виділити весь код,
 * видалити, вставити цей файл цілком → зберегти (Ctrl+S) →
 * Розгорнути → Керування розгортаннями → значок олівця →
 * Version: New version → Deploy.
 * URL webhook (GOOGLE_SHEETS_WEBHOOK_URL) залишається той самий,
 * нічого міняти в Cloudflare не треба.
 */

var COL = {
  DATE: 1,
  NAME: 2,
  PHONE: 3,
  FORMAT: 4,
  COMMENT: 5,
  STATUS: 6,
  ANKETA_STATUS: 7,
  SOURCE: 8,
};

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    if (data.stage === "anketa_click") {
      var updated = updateAnketaStatus(sheet, data.phone);
      if (!updated) {
        appendLeadRow(sheet, data, "Клієнт перейшов до анкети");
      }
    } else {
      appendLeadRow(sheet, data, "");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function appendLeadRow(sheet, data, anketaStatus) {
  var row = [];
  row[COL.DATE - 1] = data.timestamp || new Date().toISOString();
  row[COL.NAME - 1] = data.name || "";
  row[COL.PHONE - 1] = data.phone || "";
  row[COL.FORMAT - 1] = data.format || "";
  row[COL.COMMENT - 1] = data.comment || "";
  row[COL.STATUS - 1] = "новий";
  row[COL.ANKETA_STATUS - 1] = anketaStatus || "";
  row[COL.SOURCE - 1] = data.source || "";
  // I, J, K, L (Наступний контакт, Відповідальний, Коментар, Сума угоди) —
  // лишаємо порожніми, заповнюються вручну командою.
  sheet.appendRow(row);

  // Примусово форматуємо клітинку з телефоном як ТЕКСТ і перезаписуємо
  // значення — інакше Google Таблиці самі перетворюють "+380..." на число
  // і гублять знак "+".
  var newRow = sheet.getLastRow();
  sheet.getRange(newRow, COL.PHONE)
    .setNumberFormat("@")
    .setValue(data.phone || "");
}

// Прибирає все, крім цифр — щоб порівнювати телефони незалежно від того,
// зберегла їх Таблиця як текст ("+380968558031") чи як число (380968558031).
function normalizePhoneDigits(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[^0-9]/g, "");
}

// Шукає останній рядок цього клієнта (за телефоном) без заповненого
// "Статус анкети" і проставляє туди позначку. Повертає true, якщо знайшла.
function updateAnketaStatus(sheet, phone) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !phone) return false;

  var targetDigits = normalizePhoneDigits(phone);
  if (!targetDigits) return false;

  var numCols = Math.max(sheet.getLastColumn(), COL.ANKETA_STATUS);
  var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    var rowDigits = normalizePhoneDigits(values[i][COL.PHONE - 1]);
    var rowAnketaStatus = values[i][COL.ANKETA_STATUS - 1];
    if (rowDigits && rowDigits === targetDigits && !rowAnketaStatus) {
      sheet.getRange(i + 2, COL.ANKETA_STATUS).setValue("Клієнт перейшов до анкети");
      return true;
    }
  }
  return false;
}
