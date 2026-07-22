import 'dotenv/config';
import wolfjs from 'wolf.js';
import { chromium } from 'playwright';

const { WOLF } = wolfjs;
const service = new WOLF();

// ==================== الإعدادات الأساسية ====================
const TARGET_GROUP = 18432094;
const TARGET_DATE = "2026-07-23";       // 📅 غير التاريخ هنا إلى التاريخ المطلوب
const TARGET_MEMBER_ID = 80055399;      // العضوية التي رفعت الفعالية
const MEMBERSHIP_NUMBER = "224";        // رقم عضويتك الأساسي في النموذج
const FORM_URL = "https://survey-poll.typeform.com/to/JTsKMIEB"; // رابط النموذج
// ============================================================

const formatTime = (date) => {
    const h = date.getUTCHours();
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
};

// دالة رفع الفعاليات تدريجياً عبر Playwright
async function submitEventsToForm(events) {
    if (events.length === 0) {
        console.log("⚠️ لا توجد فعاليات مطابقة في هذا التاريخ ليتم رفعها.");
        return;
    }

    console.log(`\n🚀 تم العثور على (${events.length}) فعالية. بدء الرفع التلقائي للنموذج...`);
    const browser = await chromium.launch({ headless: true, slowMo: 50 });
    const context = await browser.newContext();
    const topicLetters = ['A', 'B', 'C'];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const currentLetter = topicLetters[i % topicLetters.length];
        const [year, month, day] = event.dateStr.split('-');
        const programDateObj = { month, day, year };

        const page = await context.newPage();
        console.log(`\n----------------------------------------`);
        console.log(`[رفع الفعالية ${i + 1} من ${events.length}] 🆔 ID: ${event.id} | ⏰ الوقت: ${event.timeStr}`);

        try {
            await page.goto(FORM_URL, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1000);

            // زر البدء إن وجد
            try {
                const startButton = page.getByText('سجل برنامجك الآن', { exact: false });
                await startButton.waitFor({ timeout: 3000 });
                await startButton.click();
                await page.waitForTimeout(500);
            } catch (e) {}

            // 1. رقم عضويتك
            const input1 = page.locator('input:visible, textarea:visible').first();
            await input1.fill(MEMBERSHIP_NUMBER);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);

            // 2. رقم عضوية القناة/المجموعة
            const input2 = page.locator('input:visible, textarea:visible').first();
            await input2.fill(String(TARGET_GROUP));
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);

            // 3. الثيم الأسبوعي (اختيار "نعم")
            try {
                const option = page.getByText('نعم', { exact: false }).first();
                await option.click();
            } catch (e) {
                await page.keyboard.press('a');
            }
            await page.waitForTimeout(800);

            // 4. اختيار الحرف (A, B, C)
            try {
                const badge = page.getByText(currentLetter.toUpperCase(), { exact: true }).first();
                await badge.click();
            } catch (e) {
                await page.keyboard.press(currentLetter.toLowerCase());
            }
            await page.waitForTimeout(800);

            // 5. تاريخ الفعالية (MM / DD / YYYY)
            const clickAndType = async (placeholder, value) => {
                try {
                    const input = page.getByPlaceholder(placeholder).first();
                    await input.click({ timeout: 2500 });
                    await page.keyboard.insertText(value);
                    return true;
                } catch (e) { return false; }
            };
            await clickAndType('MM', month);
            await page.waitForTimeout(300);
            await clickAndType('DD', day);
            await page.waitForTimeout(300);
            await clickAndType('YYYY', year);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);

            // 6. وقت الفعالية المستخرج
            try {
                const inputTime = page.locator('input:visible').first();
                await inputTime.click({ timeout: 2500 });
                await page.keyboard.insertText(event.timeStr);
            } catch (e) {
                await page.keyboard.insertText(event.timeStr);
            }
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);

            // 7. معرف الفعالية (ID) المستخرج
            try {
                const inputId = page.locator('input:visible, textarea:visible').first();
                await inputId.click({ timeout: 2500 });
                await page.keyboard.insertText(String(event.id));
            } catch (e) {
                await page.keyboard.insertText(String(event.id));
            }
            await page.waitForTimeout(500);

            // إرسال النموذج نهائياً
            await page.keyboard.press('Control+Enter');
            await page.waitForTimeout(1500);

            try {
                const submitEl = page.getByText('Submit', { exact: true }).first();
                await submitEl.click({ force: true });
                await page.waitForTimeout(1000);
            } catch (e) {}

            console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`);
        } catch (err) {
            console.error(`❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`, err.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log('\n========================================');
    console.log('🏁 تم الانتهاء من رفع جميع الفعاليات بنجاح تام.');
    console.log('========================================\n');
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
