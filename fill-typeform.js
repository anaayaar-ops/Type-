import wolfjs from 'wolf.js';
import { chromium } from 'playwright';

const { WOLF } = wolfjs;
const service = new WOLF();

// ==================== ⚙️ البيانات الثابتة ====================
const TARGET_GROUP = 18432094;
const TARGET_DATE = "2026-08-10";           // التاريخ المطلوب
const TARGET_MEMBER_ID = 80055399;          // العضوية التي رفعت الفعالية
const MEMBERSHIP_NUMBER = "224";            // رقم عضويتك الأساسي في النموذج
const FORM_URL = "https://survey-poll.typeform.com/to/JTsKMIEB";
const TYPE_DELAY = 40;
// =============================================================

const USER_EMAIL = process.env.U_MAIL;
const USER_PASSWORD = process.env.U_PASS;

if (!USER_EMAIL || !USER_PASSWORD) {
    console.error("❌ خطأ: لم يتم تعيين U_MAIL و U_PASS في متغيرات البيئة.");
    process.exit(1);
}

// ==================== دوال مساعدة ====================
const formatTime = (date) => {
    const h = date.getUTCHours();
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
};

const typeReal = async (page, value, { pressEnterAfter = false } = {}) => {
    await page.keyboard.type(String(value), { delay: TYPE_DELAY });
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
};

const fillActiveQuestion = async (page, value, { pressEnterAfter = true, waitAfter = 500 } = {}) => {
    try {
        await page.waitForFunction(() => {
            const el = document.activeElement;
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true');
        }, { timeout: 8000 });
        const active = page.locator('input:focus, textarea:focus, [contenteditable="true"]:focus').first();
        await active.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
        console.log('⚠️ لم يتم رصد فوكس تلقائي، أحاول الضغط على آخر حقل ظاهر...');
        const fallback = page.locator('input:visible, textarea:visible, [contenteditable="true"]:visible').last();
        await fallback.click({ timeout: 8000 });
    }
    await typeReal(page, value);
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(waitAfter);
};

const clickOkButton = async (page) => {
    try {
        const okButton = page.getByRole('button', { name: /^OK$/i }).first();
        await okButton.click({ timeout: 3000 });
        return true;
    } catch (e) {
        return false;
    }
};

const fillDateField = async (page, placeholderPart, value) => {
    const selectors = [
        `input[placeholder*="${placeholderPart}" i]:visible`,
        `input[placeholder*="${placeholderPart.toLowerCase()}" i]:visible`
    ];
    for (const selector of selectors) {
        try {
            const input = await page.waitForSelector(selector, { timeout: 4000 });
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await input.fill(value);
            await page.waitForTimeout(200);
            const actual = await input.inputValue();
            if (actual === value) return true;
            // إعادة المحاولة مرة أخرى
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await input.fill(value);
            await page.waitForTimeout(200);
            return true;
        } catch (e) { /* جرب المحدد التالي */ }
    }
    console.log(`⚠️ لم يتم إيجاد حقل placeholder="${placeholderPart}"، أحاول الكتابة مباشرة...`);
    try {
        await page.keyboard.type(value);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        return true;
    } catch (e2) {
        console.log(`❌ فشلت محاولة تعبئة ${placeholderPart}.`);
        return false;
    }
};

/**
 * دالة جديدة للانتظار حتى ظهور أي عنصر إدخال في النموذج
 * تستخدم عدة محددات وتعيد العنصر الأول الذي يظهر
 */
const waitForAnyInput = async (page, timeout = 15000) => {
    const selectors = [
        'input:visible',
        'textarea:visible',
        '[contenteditable="true"]:visible',
        '[role="textbox"]:visible',
        'div[contenteditable="true"]:visible'
    ];
    const start = Date.now();
    while (Date.now() - start < timeout) {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    // تحقق من أنه مرئي وقابل للتفاعل
                    const isVisible = await element.isVisible();
                    if (isVisible) {
                        return element;
                    }
                }
            } catch (e) { /* تجاهل */ }
        }
        await page.waitForTimeout(500);
    }
    return null;
};

// ==================== الدالة الرئيسية ====================

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
            await page.waitForTimeout(1000);

            // محاولة الضغط على أي زر بدء (مثل "سجل برنامجك الآن")
            const startButtonTexts = ['سجل برنامجك الآن', 'Start', 'Begin', 'Get started', 'ابدأ'];
            for (const text of startButtonTexts) {
                try {
                    const btn = page.getByText(text, { exact: false }).first();
                    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await btn.click();
                        console.log('  ↳ تم الضغط على زر البدء.');
                        await page.waitForTimeout(800);
                        break;
                    }
                } catch (e) { /* تجاهل */ }
            }

            // انتظر ظهور أي حقل إدخال باستخدام الدالة الجديدة
            console.log('  ↳ في انتظار ظهور حقول النموذج...');
            const inputElement = await waitForAnyInput(page, 15000);
            if (!inputElement) {
                // في حال عدم العثور على أي حقل، نأخذ لقطة ونطبع جزء من الـ HTML للتشخيص
                const screenshot = await page.screenshot({ path: `debug_${event.id}.png` });
                console.log(`⚠️ لم يتم العثور على أي حقل إدخال في النموذج. تم حفظ لقطة للصفحة: debug_${event.id}.png`);
                const html = await page.content();
                console.log('📄 أول 500 حرف من الـ HTML:', html.substring(0, 500));
                throw new Error('لم يتم العثور على حقل إدخال في النموذج');
            }
            console.log('  ↳ تم العثور على حقل إدخال.');

            // بقية الخطوات (كما هي)
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
            await fillDateField(page, 'MM', month);
            await page.waitForTimeout(300);
            await fillDateField(page, 'DD', day);
            await page.waitForTimeout(300);
            await fillDateField(page, 'YYYY', year);
            await page.waitForTimeout(300);

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

            try {
                const submitEl = page.getByText('Submit', { exact: true }).first();
                if (await submitEl.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await submitEl.click({ force: true });
                    await page.waitForTimeout(500);
                }
            } catch (e) {}

            let confirmed = false;
            try {
                await page.waitForURL(/thank|thanks|success/i, { timeout: 5000 });
                confirmed = true;
            } catch (e) {
                try {
                    await page.waitForSelector('text=/شكرا|تم استلام|Thank you/i', { timeout: 3000 });
                    confirmed = true;
                } catch (e2) {}
            }

            if (confirmed) {
                console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`);
            } else {
                console.log(`⚠️ لم تظهر صفحة الشكر للفعالية (ID: ${event.id}).`);
            }
        } catch (err) {
            console.error(`❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`, err.message);
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

        const listResponse = await service.websocket.emit('group event list', {
            id: TARGET_GROUP,
            languageId: 1,
            subscribe: true
        });

        if (!listResponse.success) {
            console.log("❌ فشل جلب قائمة الفعاليات.");
            return process.exit();
        }

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

        const fullEvents = await service.event.getByIds(dayEventIds.map(e => e.id), true);
        const foundEvents = [];

        fullEvents.forEach((fullEv) => {
            const meta = dayEventIds.find(e => e.id === fullEv.id);
            if (!meta) return;
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

service.login(USER_EMAIL, USER_PASSWORD);
