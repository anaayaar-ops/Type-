import wolfjs from 'wolf.js';
import { chromium } from 'playwright';

const { WOLF } = wolfjs;
const service = new WOLF();

// ==================== ⚙️ البيانات الثابتة (عدّل حسب حاجتك) ====================
const TARGET_GROUP = 18432094;
const TARGET_DATE = "2026-08-10";           // التاريخ المطلوب (YYYY-MM-DD)
const TARGET_MEMBER_ID = 80055399;          // العضوية التي رفعت الفعالية
const MEMBERSHIP_NUMBER = "224";            // رقم عضويتك الأساسي في النموذج
const FORM_URL = "https://survey-poll.typeform.com/to/JTsKMIEB";
const TYPE_DELAY = 40;                      // تأخير بين الأحرف (مللي)
// =============================================================================

// 🔐 البريد وكلمة المرور تؤخذ من متغيرات البيئة (GitHub Secrets)
const USER_EMAIL = process.env.U_MAIL;
const USER_PASSWORD = process.env.U_PASS;

if (!USER_EMAIL || !USER_PASSWORD) {
    console.error("❌ خطأ: لم يتم تعيين U_MAIL و U_PASS في متغيرات البيئة.");
    process.exit(1);
}

// ==================== دوال مساعدة محسّنة ====================

/**
 * تنسيق الوقت إلى صيغة 12 ساعة مع AM/PM
 */
const formatTime = (date) => {
    const h = date.getUTCHours();
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
};

/**
 * كتابة نص مع تأخير بين الأحرف (لمحاكاة الكتابة البشرية)
 */
const typeReal = async (page, value, { pressEnterAfter = false } = {}) => {
    await page.keyboard.type(String(value), { delay: TYPE_DELAY });
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
};

/**
 * ملء الحقل النشط الحالي (بعد التأكد من وجوده والتركيز عليه)
 * - يحاول انتظار وجود عنصر نشط
 * - في حال الفشل، يضغط على آخر حقل إدخال ظاهر
 */
const fillActiveQuestion = async (page, value, { pressEnterAfter = true, waitAfter = 500 } = {}) => {
    try {
        // انتظار ظهور عنصر نشط (input أو textarea)
        await page.waitForFunction(() => {
            const el = document.activeElement;
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        }, { timeout: 8000 });
        const active = page.locator('input:focus, textarea:focus').first();
        await active.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
        console.log('⚠️ لم يتم رصد فوكس تلقائي، أحاول الضغط على آخر حقل ظاهر...');
        const fallback = page.locator('input:visible, textarea:visible').last();
        await fallback.click({ timeout: 8000 });
    }
    await typeReal(page, value);
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(waitAfter);
};

/**
 * محاولة الضغط على زر OK (إن وجد)
 */
const clickOkButton = async (page) => {
    try {
        const okButton = page.getByRole('button', { name: /^OK$/i }).first();
        await okButton.click({ timeout: 3000 });
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * ملء حقول التاريخ بطريقة أكثر مرونة
 * - تبحث عن حقل يحتوي على النص المطلوب في placeholder (مطابقة جزئية)
 * - تستخدم page.fill لتعبئة القيمة (أكثر دقة من الكتابة)
 * - في حال عدم العثور على الحقل، تحاول كتابة القيمة ثم الضغط على Tab
 */
const fillDateField = async (page, placeholderPart, value) => {
    // محاولة مطابقة جزئية لـ placeholder (بغض النظر عن حالة الأحرف)
    const selector = `input[placeholder*="${placeholderPart}" i]:visible`;
    try {
        const input = await page.waitForSelector(selector, { timeout: 4000 });
        await input.click({ clickCount: 3 }); // تحديد النص الموجود
        await page.keyboard.press('Backspace'); // مسح ما تم تحديده
        await input.fill(value);
        await page.waitForTimeout(200);
        // تحقق من القيمة المدخلة
        const actual = await input.inputValue();
        if (actual !== value) {
            console.log(`⚠️ إعادة محاولة تعبئة ${placeholderPart}`);
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await input.fill(value);
        }
        return true;
    } catch (e) {
        console.log(`⚠️ لم يتم إيجاد حقل placeholder="${placeholderPart}"، أحاول الكتابة مباشرة...`);
        // محاولة كتابة القيمة في الحقل النشط ثم Tab
        try {
            await page.keyboard.type(value);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(200);
        } catch (e2) {
            console.log(`❌ فشلت محاولة تعبئة ${placeholderPart} بالكامل.`);
        }
        return false;
    }
};

// ==================== الدالة الرئيسية لرفع الفعاليات ====================

async function submitEventsToForm(events) {
    if (events.length === 0) {
        console.log("⚠️ لا توجد فعاليات مطابقة في هذا التاريخ ليتم رفعها.");
        return;
    }

    console.log(`\n🚀 تم العثور على (${events.length}) فعالية. بدء الرفع التلقائي للنموذج...`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const topicLetters = ['A', 'B', 'C'];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const currentLetter = topicLetters[i % topicLetters.length];
        const [year, month, day] = event.dateStr.split('-');

        const page = await context.newPage();
        console.log(`\n----------------------------------------`);
        console.log(`[رفع الفعالية ${i + 1} من ${events.length}] 🆔 ID: ${event.id} | ⏰ الوقت: ${event.timeStr}`);

        try {
            console.log('  ↳ [الخطوة 0] فتح صفحة النموذج...');
            await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(800);

            // في حال وجود زر بدء
            try {
                const startButton = page.getByText('سجل برنامجك الآن', { exact: false });
                if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await startButton.click();
                    await page.waitForTimeout(500);
                }
            } catch (e) {}

            // انتظر ظهور أول حقل إدخال ليكون النموذج جاهزاً
            await page.waitForSelector('input:visible, textarea:visible', { timeout: 10000 });

            console.log('  ↳ [الخطوة 1] رقم العضوية...');
            await fillActiveQuestion(page, MEMBERSHIP_NUMBER);

            console.log('  ↳ [الخطوة 2] رقم عضوية القناة...');
            await fillActiveQuestion(page, String(TARGET_GROUP));

            console.log('  ↳ [الخطوة 3] الثيم الأسبوعي (نعم)...');
            try {
                const option = page.getByText('نعم', { exact: false }).first();
                if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await option.click();
                } else {
                    await page.keyboard.press('a');
                }
            } catch (e) {
                await page.keyboard.press('a');
            }
            await page.waitForTimeout(500);

            console.log(`  ↳ [الخطوة 4] اختيار المواضيع (الحرف ${currentLetter})...`);
            try {
                const badge = page.getByText(currentLetter.toUpperCase(), { exact: true }).first();
                if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await badge.click();
                } else {
                    await page.keyboard.press(currentLetter.toLowerCase());
                }
            } catch (e) {
                await page.keyboard.press(currentLetter.toLowerCase());
            }
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);

            console.log('  ↳ [الخطوة 5] تاريخ الفعالية...');
            // استخدام الدالة المحسّنة لتعبئة التاريخ
            await fillDateField(page, 'MM', month);
            await page.waitForTimeout(300);
            await fillDateField(page, 'DD', day);
            await page.waitForTimeout(300);
            await fillDateField(page, 'YYYY', year);
            await page.waitForTimeout(300);

            // الضغط على OK أو Enter
            const okClicked = await clickOkButton(page);
            if (!okClicked) {
                console.log('⚠️ لم أجد زر OK، أضغط Enter...');
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(600);

            console.log('  ↳ [الخطوة 6] وقت الفعالية...');
            await fillActiveQuestion(page, event.timeStr);

            console.log('  ↳ [الخطوة 7] معرف الفعالية (ID)...');
            await fillActiveQuestion(page, String(event.id), { pressEnterAfter: false, waitAfter: 300 });

            console.log('  ↳ [الإرسال النهائي] Ctrl+Enter...');
            await page.keyboard.press('Control+Enter');
            await page.waitForTimeout(800);

            // محاولة الضغط على زر Submit إن وجد
            try {
                const submitEl = page.getByText('Submit', { exact: true }).first();
                if (await submitEl.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await submitEl.click({ force: true });
                    await page.waitForTimeout(500);
                }
            } catch (e) {}

            // التحقق من النجاح باستخدام تغيير URL أو ظهور رسالة شكر
            let confirmed = false;
            try {
                // انتظر تغيير URL إلى صفحة الشكر (قد تحتوي على thank أو thanks أو success)
                await page.waitForURL(/thank|thanks|success/i, { timeout: 5000 });
                confirmed = true;
            } catch (e) {
                // إذا لم يتغير URL، تحقق من وجود نص شكر
                try {
                    await page.waitForSelector('text=/شكرا|تم استلام|Thank you/i', { timeout: 3000 });
                    confirmed = true;
                } catch (e2) {}
            }

            if (confirmed) {
                console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`);
            } else {
                console.log(`⚠️ لم تظهر صفحة الشكر للفعالية (ID: ${event.id}). قد يكون الإرسال ناجحاً لكن النموذج لم ينتقل.`);
            }
        } catch (err) {
            console.error(`❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`, err.message);
            // يمكن طباعة عنوان الصفحة أو الـ HTML للمساعدة في التصحيح
            // console.log(await page.content());
        } finally {
            await page.close();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    await browser.close();
    console.log(`\n========================================`);
    console.log('🏁 تم الانتهاء من رفع جميع الفعاليات.');
    console.log(`========================================\n`);
}

// ==================== الاتصال بـ WOLF ====================

service.on('ready', async () => {
    console.log(`✅ متصل بنجاح بـ: ${service.currentSubscriber.nickname}`);

    try {
        console.log(`🔍 جاري فحص وجلب فعاليات تاريخ: ${TARGET_DATE} للعضوية: ${TARGET_MEMBER_ID}...`);

        // جلب قائمة الفعاليات
        const listResponse = await service.websocket.emit('group event list', {
            id: TARGET_GROUP,
            languageId: 1,
            subscribe: true
        });

        if (!listResponse.success) {
            console.log("❌ فشل جلب قائمة الفعاليات.");
            return process.exit();
        }

        // تصفية الفعاليات حسب التاريخ المطلوب
        const dayEventIds = [];
        for (const ev of listResponse.body) {
            const info = ev.additionalInfo || {};
            const startTimeStr = info.startsAt || ev.startsAt;
            if (!startTimeStr) continue;

            const startTime = new Date(startTimeStr);
            const ksaStart = new Date(startTime.getTime() + (3 * 60 * 60 * 1000));
            const dateStr = `${ksaStart.getUTCFullYear()}-${String(ksaStart.getUTCMonth() + 1).padStart(2, '0')}-${String(ksaStart.getUTCDate()).padStart(2, '0')}`;
            if (dateStr !== TARGET_DATE) continue;

            dayEventIds.push({ id: ev.id, dateStr, start: ksaStart });
        }

        // جلب التفاصيل الكاملة لكل فعالية
        const fullEvents = await service.event.getByIds(dayEventIds.map(e => e.id), true);
        const foundEvents = [];

        fullEvents.forEach((fullEv) => {
            const meta = dayEventIds.find(e => e.id === fullEv.id);
            if (!meta) return;
            // التأكد من أن الفعالية مرفوعة بواسطة العضوية المستهدفة
            if (fullEv.createdBy !== null && parseInt(fullEv.createdBy) === TARGET_MEMBER_ID) {
                foundEvents.push({
                    id: fullEv.id,
                    dateStr: meta.dateStr,
                    timeStr: formatTime(meta.start),
                    start: meta.start
                });
            }
        });

        foundEvents.sort((a, b) => a.start - b.start);

        console.log(`\n📋 تم العثور على ${foundEvents.length} فعالية مطابقة.`);
        await submitEventsToForm(foundEvents);

    } catch (err) {
        console.error("❌ حدث خطأ:", err.message);
    }

    process.exit();
});

// بدء تسجيل الدخول
service.login(USER_EMAIL, USER_PASSWORD);
