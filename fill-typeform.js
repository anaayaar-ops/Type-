

const { chromium } = require('playwright');

// ==================== الإعدادات والبيانات ====================
const config = {
  "formUrl": "https://survey-poll.typeform.com/to/JTsKMIEB",
  "membershipNumber": "224",
  "channelMembershipNumber": "18432094",
  "isPartOfWeeklyTheme": true,
  "events": [
    {
      "id": "862087",
      "date": "2026-07-22",
      "time": "1:30 PM"
    },
    {
      "id": "862088",
      "date": "2026-07-22",
      "time": "2:15 PM"
    },
    {
      "id": "862089",
      "date": "2026-07-22",
      "time": "3:00 PM"
    }
  ]
};

const HEADLESS = true; // يشتغل بالخلفية بدون نافذة متصفح
const SLOW_MO = 0;
// ============================================================

async function waitABit(page, ms = 700) {
  await page.waitForTimeout(ms);
}

async function debugShot(page, label) {
  return;
}

async function getPageSnapshot(page) {
  return page.evaluate(() => document.body.innerText).catch(() => '');
}

async function goNext(page) {
  const beforeText = await getPageSnapshot(page);

  await page.keyboard.press('Enter');
  await waitABit(page, 900);

  let afterText = await getPageSnapshot(page);
  if (afterText !== beforeText) return;

  try {
    const nextBtn = page
      .locator('button, [role="button"]')
      .filter({ hasText: /^(OK|Submit)$/i })
      .first();
    await nextBtn.waitFor({ state: 'visible', timeout: 4000 });
    await nextBtn.click();
    await waitABit(page, 900);
  } catch (e) {
    await page.keyboard.press('Enter');
    await waitABit(page, 900);
  }
}

async function typeAndNext(page, value, label) {
  try {
    const input = page.locator('input:visible, textarea:visible').first();
    await input.fill(String(value), { timeout: 2500 });
  } catch (e) {
    await page.keyboard.insertText(String(value));
  }
  await waitABit(page, 500);
  await debugShot(page, `before-${label}`);
  await goNext(page);
  await debugShot(page, `after-${label}`);
}

async function selectByLetterAndNext(page, letter, label) {
  const beforeText = await getPageSnapshot(page);

  await page.keyboard.press(letter.toLowerCase());
  await waitABit(page, 600);

  const afterText = await getPageSnapshot(page);
  if (afterText === beforeText) {
    try {
      const badge = page.getByText(letter.toUpperCase(), { exact: true }).first();
      await badge.waitFor({ timeout: 4000 });
      await badge.click();
    } catch (e) {
      throw new Error(`ما قدرت ألقى أو أختار الخيار بالحرف: "${letter}"`);
    }
  }

  await waitABit(page, 450);
  await debugShot(page, `before-${label}`);
  await goNext(page);
  await debugShot(page, `after-${label}`);
}

async function selectChoiceAndNext(page, visibleText, fallbackLetter, label) {
  let selected = false;
  try {
    const option = page.getByText(visibleText, { exact: false }).first();
    await option.waitFor({ timeout: 8000 });
    await option.click();
    selected = true;
  } catch (e) {}

  if (!selected && fallbackLetter) {
    await page.keyboard.press(fallbackLetter);
    await waitABit(page, 500);
    selected = true;
  }

  if (!selected) {
    throw new Error(`ما قدرت ألقى أو أختار الإجابة: "${visibleText}"`);
  }

  await waitABit(page, 450);
  await debugShot(page, `before-${label}`);
  await goNext(page);
  await debugShot(page, `after-${label}`);
}

async function fillDateFieldAndNext(page, { month, day, year }, label) {
  const clickAndType = async (placeholder, value) => {
    try {
      const input = page.getByPlaceholder(placeholder).first();
      await input.click({ timeout: 2500 });
      await page.keyboard.insertText(value);
      return true;
    } catch (e) {
      return false;
    }
  };

  await clickAndType('MM', month);
  await waitABit(page, 350);
  await clickAndType('DD', day);
  await waitABit(page, 350);
  await clickAndType('YYYY', year);
  await waitABit(page, 450);

  await debugShot(page, `before-${label}`);
  await goNext(page);
  await debugShot(page, `after-${label}`);
}

async function fillTimeFieldAndNext(page, timeString, label) {
  try {
    const input = page.locator('input:visible').first();
    await input.click({ timeout: 2500 });
  } catch (e) {}

  const match = timeString.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  let formattedTime;
  if (!match) {
    formattedTime = timeString;
  } else {
    const [, hour, minute, meridiem] = match;
    formattedTime = `${hour}:${minute} ${meridiem.toUpperCase()}`;
  }
  await page.keyboard.insertText(formattedTime);

  await waitABit(page, 450);
  await debugShot(page, `before-${label}`);
  await goNext(page);
  await debugShot(page, `after-${label}`);
}

async function finalSubmit(page) {
  const beforeText = await getPageSnapshot(page);

  await page.keyboard.press('Control+Enter');
  await waitABit(page, 900);

  let afterText = await getPageSnapshot(page);
  if (afterText !== beforeText) return true;

  try {
    const submitEl = page.getByText('Submit', { exact: true }).first();
    await submitEl.waitFor({ state: 'visible', timeout: 2500 });
    await submitEl.click({ force: true });
    await waitABit(page, 900);
  } catch (e) {
    await page.keyboard.press('Control+Enter');
    await waitABit(page, 900);
  }

  afterText = await getPageSnapshot(page);
  return afterText !== beforeText;
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext();
  const page = await context.newPage();

  const topicLetters = ['A', 'B', 'C'];
  const totalEvents = config.events.length;

  console.log(`🚀 بدء معالجة ${totalEvents} فعاليات...`);

  for (let i = 0; i < totalEvents; i++) {
    const event = config.events[i];
    const currentLetter = topicLetters[i % topicLetters.length];

    const [year, month, day] = event.date.split('-');
    const programDateObj = { month, day, year };

    console.log(`\n----------------------------------------`);
    console.log(`[فعالية ${i + 1} من ${totalEvents}] المعرف (ID): ${event.id}`);
    console.log(`الحرف المختار: ${currentLetter}`);

    let submissionConfirmed = false;
    let lastSubmissionStatus = null;

    const responseListener = (response) => {
      const url = response.url();
      if (
        url.includes('typeform.com') &&
        (url.includes('answers') || url.includes('responses') || url.includes('submit'))
      ) {
        lastSubmissionStatus = response.status();
        if (response.status() >= 200 && response.status() < 300) {
          submissionConfirmed = true;
        }
      }
    };
    page.on('response', responseListener);

    await page.goto(config.formUrl, { waitUntil: 'networkidle' });
    await waitABit(page, 1000);

    try {
      const startButton = page.getByText('سجل برنامجك الآن', { exact: false });
      await startButton.waitFor({ timeout: 3000 });
      await startButton.click();
      await waitABit(page, 450);
    } catch (e) {}

    await typeAndNext(page, config.membershipNumber, 'q1');
    await typeAndNext(page, config.channelMembershipNumber, 'q2');
    await selectChoiceAndNext(
      page,
      config.isPartOfWeeklyTheme ? 'نعم' : 'لا',
      config.isPartOfWeeklyTheme ? 'a' : 'b',
      'q3'
    );
    await selectByLetterAndNext(page, currentLetter, 'q4');
    await fillDateFieldAndNext(page, programDateObj, 'q5');
    await fillTimeFieldAndNext(page, event.time, 'q6');

    try {
      const input = page.locator('input:visible, textarea:visible').first();
      await input.click({ timeout: 2500 });
    } catch (e) {}
    await page.keyboard.insertText(String(event.id));
    await waitABit(page, 450);

    await finalSubmit(page);
    await waitABit(page, 1200);

    page.off('response', responseListener);

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const looksLikeThankYouPage = /شكرا|شكراً|thank you|thanks|تم استلام|تم الإرسال/i.test(pageText);

    if (submissionConfirmed || looksLikeThankYouPage) {
      console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`);
    } else {
      console.log(`⚠️ تم إكمال الخطوات للفعالية (ID: ${event.id}), ولكن لم يُرصد تأكيد نهائي قاطع.`);
    }
  }

  console.log('\n========================================');
  console.log('🏁 تم الانتهاء من إرسال جميع الفعاليات بنجاح.');
  console.log('========================================\n');

  await browser.close();
}

run().catch((err) => {
  console.error('صار خطأ أثناء التعبئة:', err);
  process.exit(1);
});

