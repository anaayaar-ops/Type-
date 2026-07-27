import 'dotenv/config';
import wolfjs from 'wolf.js';
import { chromium } from 'playwright';

const { WOLF } = wolfjs;
const service = new WOLF();

// ==================== الإعدادات الأساسية ====================
const TARGET_GROUP = 18432094;
const TARGET_DATE = "2026-07-30";       // 📅 غير التاريخ هنا إلى التاريخ المطلوب
const TARGET_MEMBER_ID = 80055399;      // العضوية التي رفعت الفعالية
const MEMBERSHIP_NUMBER = "224";        // رقم عضويتك الأساسي في النموذج
const FORM_URL = "https://survey-poll.typeform.com/to/JTsKMIEB"; // رابط النموذج
const TYPE_DELAY = 40;                  // تأخير بالمللي ثانية بين كل حرف (كافي لتوليد أحداث حقيقية بدون بطء)
// ============================================================

const formatTime = (date) => {
    const h = date.getUTCHours();
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
};

// كتابة نص بشكل حقيقي (يطلق أحداث keydown/keypress فعلية بدل حقنها مباشرة)
// هذا هو الإصلاح الأساسي: insertText() كانت لا تطلق أحداث حقيقية فتفشل حقول React/Typeform
// في تسجيل القيمة (فتظهر رسالة "please fill in" رغم ظهور النص بصرياً).
const typeReal = async (page, value, { pressEnterAfter = false } = {}) => {
    await page.keyboard.type(String(value), { delay: TYPE_DELAY });
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
};

// يحل مشكلة "التعليق" عند الانتقال بين الأسئلة: بدل ما نمسك أول input ظاهر
// بالصفحة (ممكن يكون عنصر السؤال القديم وهو لسا بمرحلة الاختفاء/الأنيميشن)،
// ننتظر فعلياً لين يتولد فوكس حقيقي على حقل جديد (Typeform يعطي فوكس تلقائي
// للحقل النشط بعد انتهاء الانتقال)، وبعدها نكتب فيه مباشرة.
const fillActiveQuestion = async (page, value, { pressEnterAfter = true, waitAfter = 500 } = {}) => {
    try {
        await page.waitForFunction(() => {
            const el = document.activeElement;
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        }, { timeout: 5000 });
        const active = page.locator('input:focus, textarea:focus').first();
        await active.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
        console.log('⚠️ لم يتم رصد فوكس تلقائي، أحاول أضغط على آخر حقل ظاهر...');
        const fallback = page.locator('input:visible, textarea:visible').last();
        await fallback.click({ timeout: 5000 });
    }
    await typeReal(page, value);
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(waitAfter);
};

// دالة تشخيصية: تطبع نص العنوان الحالي الظاهر على الشاشة (أي سؤال واقفين عليه فعلياً).
// مفيدة جداً لمعرفة السؤال المجهول (زي "السؤال 8") بدل ما نخمن رقمه.
const logCurrentQuestion = async (page, label) => {
    try {
        const heading = await page.locator('[data-qa="question-wrapper"], [role="group"]')
            .locator('h1, h2, [role="heading"]')
            .first()
            .innerText({ timeout: 2000 });
        console.log(`   📝 [${label}] السؤال الظاهر حالياً: "${heading.trim()}"`);
    } catch (e) {
        console.log(`   📝 [${label}] تعذر قراءة عنوان السؤال الحالي.`);
    }
};

// دالة رفع الفعاليات تدريجياً عبر Playwright
async function submitEventsToForm(events) {
    if (events.length === 0) {
        console.log("⚠️ لا توجد فعاليات مطابقة في هذا التاريخ ليتم رفعها.");
        return;
    }

    console.log(`\n🚀 تم العثور على (${events.length}) فعالية. بدء الرفع التلقائي للنموذج...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
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
            // ملاحظة مهمة: 'networkidle' كانت هي سبب انتظار الـ 30 ثانية بين كل فعالية،
            // لأن صفحات Typeform فيها اتصالات شبكة خلفية مستمرة (تحليلات/تتبع) ما تتوقف
            // أبداً، فـ Playwright يضل منتظر لين يضرب الـ timeout الافتراضي (30 ثانية) قبل
            // ما يكمل. 'domcontentloaded' يخلص فوراً بمجرد ما تصير الصفحة جاهزة للتفاعل.
            await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(600);

            // زر البدء إن وجد
            try {
                const startButton = page.getByText('سجل برنامجك الآن', { exact: false });
                await startButton.waitFor({ timeout: 3000 });
                await startButton.click();
                await page.waitForTimeout(300);
            } catch (e) {}

            // 1. رقم عضويتك (هذا أول سؤال بالصفحة، عادة يكون معه فوكس تلقائي فوراً)
            console.log('  ↳ [الخطوة 1] رقم العضوية...');
            await logCurrentQuestion(page, 'قبل الخطوة 1');
            await fillActiveQuestion(page, MEMBERSHIP_NUMBER);

            // 2. رقم عضوية القناة/المجموعة (هذا السؤال يجي بعد انتقال/أنيميشن،
            // فاستخدام fillActiveQuestion هنا هو اللي يحل مشكلة التعليق)
            console.log('  ↳ [الخطوة 2] رقم عضوية القناة...');
            await logCurrentQuestion(page, 'قبل الخطوة 2');
            await fillActiveQuestion(page, String(TARGET_GROUP));

            // 3. الثيم الأسبوعي (اختيار "نعم")
            console.log('  ↳ [الخطوة 3] الثيم الأسبوعي (نعم)...');
            await logCurrentQuestion(page, 'قبل الخطوة 3');
            try {
                const option = page.getByText('نعم', { exact: false }).first();
                await option.click();
            } catch (e) {
                await page.keyboard.press('a');
            }
            await page.waitForTimeout(450);

            // 4. اختيار الحرف (A, B, C) - هذا سؤال "اختر واحد أو أكثر" (Make between 1 and 3 choices)
            console.log(`  ↳ [الخطوة 4] اختيار المواضيع (الحرف ${currentLetter})...`);
            await logCurrentQuestion(page, 'قبل الخطوة 4');
            // وهالنوع من الأسئلة بـ Typeform ما يتقدم تلقائياً بعد اختيار خيار، لازم تأكيد صريح
            // بالضغط على Enter، وإلا الصفحة تفضل واقفة هنا وكل الخطوات اللي بعدها تفشل بصمت.
            try {
                const badge = page.getByText(currentLetter.toUpperCase(), { exact: true }).first();
                await badge.click({ timeout: 3000 });
            } catch (e) {
                await page.keyboard.press(currentLetter.toLowerCase());
            }
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter'); // تأكيد الاختيار المتعدد والانتقال للسؤال التالي
            await page.waitForTimeout(450);

            // 5. تاريخ الفعالية (MM / DD / YYYY)
            console.log('  ↳ [الخطوة 5] تاريخ الفعالية...');
            await logCurrentQuestion(page, 'قبل الخطوة 5');
            // ملاحظة: بعض نسخ Typeform تسمي الحقول بمسميات غير "MM"/"DD"/"YYYY" حسب اللغة.
            // لو استمرت المشكلة، فعّل سطر console.log أدناه لطباعة كل الـ placeholders
            // الظاهرة فعلياً في الصفحة، وعدّل القيم بالأسفل حسب الناتج.
            //
            // const allInputs = await page.locator('input:visible').all();
            // for (const inp of allInputs) console.log('placeholder:', await inp.getAttribute('placeholder'));

            const clickAndType = async (placeholder, value) => {
                try {
                    const input = page.getByPlaceholder(placeholder).first();
                    await input.click({ timeout: 3000 });
                    // تفريغ أي محتوى سابق قبل الكتابة، لتفادي تراكم/تشوه القيمة
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await typeReal(page, value);

                    // تحقق فعلي: نقرأ قيمة الحقل بعد الكتابة بدل ما نفترض إنها انكتبت
                    await page.waitForTimeout(200);
                    const actual = await input.inputValue().catch(() => null);
                    if (!actual || !actual.includes(String(parseInt(value, 10)))) {
                        console.log(`⚠️ حقل "${placeholder}" ما احتوى القيمة المتوقعة (المتوقع: ${value} / الموجود: "${actual}") — أعيد المحاولة...`);
                        await input.click({ timeout: 3000 });
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await typeReal(page, value);
                        await page.waitForTimeout(200);
                        const retryVal = await input.inputValue().catch(() => null);
                        console.log(`   ↳ بعد إعادة المحاولة: "${retryVal}"`);
                    }
                    return true;
                } catch (e) {
                    console.log(`⚠️ لم يتم إيجاد حقل بـ placeholder="${placeholder}":`, e.message);
                    return false;
                }
            };

            await clickAndType('MM', month);
            await page.waitForTimeout(250);
            await clickAndType('DD', day);
            await page.waitForTimeout(250);
            await clickAndType('YYYY', year);
            await page.waitForTimeout(250);

            // هذا السؤال فيه زر "OK" صريح بالفورم (شفناه بالصورة) — الأصح نضغطه
            // مباشرة بدل ما نعتمد بس على Enter، لأن بعض قوالب Typeform ما تربط
            // Enter بزر التأكيد لهذا النوع من الحقول المقسّمة (multi-part field).
            try {
                const okButton = page.getByRole('button', { name: /^OK$/i }).first();
                await okButton.click({ timeout: 3000 });
            } catch (e) {
                console.log('⚠️ ما لقيت زر OK، أجرب Enter كبديل...');
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(450);

            // 6. وقت الفعالية المستخرج
            console.log('  ↳ [الخطوة 6] وقت الفعالية...');
            await logCurrentQuestion(page, 'قبل الخطوة 6');
            await fillActiveQuestion(page, event.timeStr);

            // 7. معرف الفعالية (ID) المستخرج
            console.log('  ↳ [الخطوة 7] معرف الفعالية (ID)...');
            await logCurrentQuestion(page, 'قبل الخطوة 7');
            await fillActiveQuestion(page, String(event.id), { pressEnterAfter: false, waitAfter: 300 });

            // فحص: هل لسا فيه سؤال ما اتغطى بالكود؟ (زي "السؤال 8" المجهول)
            // لو طلع هنا اسم سؤال غير متوقع، معناته الفورم فيه سؤال إضافي بعد الـ ID
            // لازم نضيف خطوة له بالكود بدل ما نتجاهله.
            await logCurrentQuestion(page, 'بعد تعبئة كل الحقول المعروفة (تحقق من وجود سؤال إضافي هنا)');

            // إرسال النموذج نهائياً
            console.log('  ↳ [الإرسال النهائي] Ctrl+Enter...');
            await page.keyboard.press('Control+Enter');
            await page.waitForTimeout(1000);

            try {
                const submitEl = page.getByText('Submit', { exact: true }).first();
                await submitEl.click({ force: true });
                await page.waitForTimeout(700);
            } catch (e) {}

            // تحقق حقيقي من نجاح الإرسال قبل الانتقال للفعالية التالية.
            // بدون هذا التحقق، لو توقف الفورم عند سؤال ناقص (زي السؤال 8)، السكربت
            // كان يكمل بصمت للفعالية التالية بدون ما يخبرك إن الفعالية الحالية ما اكتملت.
            let confirmed = false;
            try {
                await page.getByText(/شكرا|تم استلام|Thank you/i).first().waitFor({ timeout: 4000 });
                confirmed = true;
            } catch (e) {}

            if (confirmed) {
                console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح ومؤكد بصفحة الشكر.`);
            } else {
                console.log(`⚠️ لم أتأكد من وصول صفحة الشكر للفعالية (ID: ${event.id}) — على الأرجح فيه سؤال متبقي لم تتم تعبئته (راجع سطر "تحقق من وجود سؤال إضافي" أعلاه).`);
            }
        } catch (err) {
            console.error(`❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`, err.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log(`\n========================================`);
    console.log('🏁 تم الانتهاء من رفع جميع الفعاليات بنجاح تام.');
    console.log(`========================================\n`);
}

// الاتصال بمنصة WOLF والبدء بالخطوة الأولى
service.on('ready', async () => {
    console.log(`✅ متصل بنجاح بـ: ${service.currentSubscriber.nickname}`);

    try {
        console.log(`🔍 جاري فحص وجلب فعاليات تاريخ: ${TARGET_DATE} للعضوية: ${TARGET_MEMBER_ID}...`);

        const listResponse = await service.websocket.emit('group event list', {
            id: parseInt(TARGET_GROUP),
            languageId: 1,
            subscribe: true
        });

        if (!listResponse.success) {
            console.log("❌ فشل جلب قائمة الفعاليات من المجموعة.");
            return process.exit();
        }

        const dayEventIds = [];
        for (const ev of listResponse.body) {
            const info = ev.additionalInfo || {};
            const startTimeStr = info.startsAt || ev.startsAt;
            if (!startTimeStr) continue;

            const startTime = new Date(startTimeStr);
            const ksaStart = new Date(startTime.getTime() + (3 * 60 * 60 * 1000)); // توقيت السعودية UTC+3

            const dateStr = `${ksaStart.getUTCFullYear()}-${String(ksaStart.getUTCMonth() + 1).padStart(2, '0')}-${String(ksaStart.getUTCDate()).padStart(2, '0')}`;
            if (dateStr !== TARGET_DATE) continue;

            dayEventIds.push({ id: ev.id, dateStr, start: ksaStart });
        }

        // جلب التفاصيل الكاملة للفعاليات المطابقة لتاريخ اليوم المستهدف
        const fullEvents = await service.event.getByIds(dayEventIds.map(e => e.id), true);
        const foundEvents = [];

        fullEvents.forEach((fullEv) => {
            const meta = dayEventIds.find(e => e.id === fullEv.id);
            if (!meta) return;

            // التحقق من أن الفعالية مرفوعة من العضوية المطلوبة
            if (fullEv.createdBy !== null && parseInt(fullEv.createdBy) === TARGET_MEMBER_ID) {
                foundEvents.push({
                    id: fullEv.id,
                    dateStr: meta.dateStr,
                    timeStr: formatTime(meta.start),
                    start: meta.start
                });
            }
        });

        // ترتيب الفعاليات تصاعدياً حسب الوقت
        foundEvents.sort((a, b) => a.start - b.start);

        console.log(`\n📋 تم العثور على ${foundEvents.length} فعالية مطابقة.`);

        // الانتقال للخطوة الثانية وتمرير القائمة المستخرجة لملء النماذج
        await submitEventsToForm(foundEvents);

    } catch (err) {
        console.error("❌ حدث خطأ:", err.message);
    }

    process.exit();
});

// تسجيل الدخول باستخدام البيانات المخزنة في ملف .env
service.login(process.env.U_MAIL, process.env.U_PASS);
