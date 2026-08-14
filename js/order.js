"use strict";

const BUSINESS_WHATSAPP = "966537933514";

const packageDetails = {
    basic: {
        name: "الباقة الأساسية",
        price: "ابتداءً من 199 ر.س",
        features: [
            "تصميم دعوة إلكترونية",
            "تخصيص الأسماء والتاريخ",
            "رابط جاهز للمشاركة",
            "تعديل واحد على التصميم"
        ]
    },
    advanced: {
        name: "الباقة المتقدمة",
        price: "ابتداءً من 399 ر.س",
        features: [
            "تصميم مخصص للمناسبة",
            "تنظيم بيانات الضيوف",
            "إدارة تأكيد الحضور",
            "تعديلان على التصميم",
            "دعم عبر واتساب"
        ]
    },
    premium: {
        name: "الباقة المميزة",
        price: "ابتداءً من 699 ر.س",
        features: [
            "تصميم فاخر ومخصص بالكامل",
            "إدارة متكاملة للضيوف",
            "متابعة تأكيد الحضور",
            "خدمات إضافية حسب المناسبة",
            "دعم ومتابعة مخصصة"
        ]
    },
    custom: {
        name: "باقة مخصصة",
        price: "السعر بعد مراجعة التفاصيل",
        features: [
            "تحديد الخدمات حسب احتياجك",
            "تسعير مخصص بعد مراجعة الطلب",
            "إمكانية إضافة خدمات متقدمة"
        ]
    }
};

const form = document.getElementById("order-form");
const packageSelect = document.getElementById("package");
const occasionSelect = document.getElementById("occasion");
const occasionOtherInput = document.getElementById("occasion-other");
const phoneInput = document.getElementById("phone");
const eventDateInput = document.getElementById("event-date");
const deliveryDateInput = document.getElementById("delivery-date");
const messageBox = document.getElementById("form-message");
const submitButton = document.getElementById("submit-order");
const summaryName = document.getElementById("summary-package-name");
const summaryPrice = document.getElementById("summary-package-price");
const summaryFeatures = document.getElementById("summary-package-features");
const yearElement = document.getElementById("current-year");

if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
}

const today = new Date();
const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
].join("-");

eventDateInput.min = todayString;
deliveryDateInput.min = todayString;

function formatDate(dateValue) {
    if (!dateValue) return "غير محدد";

    const date = new Date(`${dateValue}T00:00:00`);

    return new Intl.DateTimeFormat("ar-SA", {
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(date);
}

function formatTime(timeValue) {
    if (!timeValue) return "غير محدد";

    const [hours, minutes] = timeValue.split(":");
    const time = new Date();
    time.setHours(Number(hours), Number(minutes), 0, 0);

    return new Intl.DateTimeFormat("ar-SA", {
        hour: "numeric",
        minute: "2-digit"
    }).format(time);
}

function normalizeSaudiPhone(value) {
    const digits = value.replace(/\D/g, "");

    if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
    if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
    if (/^5\d{8}$/.test(digits)) return `+966${digits}`;

    return "";
}

function getSelectedServices() {
    return [...form.querySelectorAll(
        'input[name="extraServices"]:checked'
    )].map((checkbox) => checkbox.value);
}

function setMessage(text, isError = false) {
    messageBox.textContent = text;
    messageBox.hidden = false;
    messageBox.classList.toggle("is-error", isError);
}

function clearMessage() {
    messageBox.textContent = "";
    messageBox.hidden = true;
    messageBox.classList.remove("is-error");
}

function updatePackageSummary() {
    const selectedPackage = packageDetails[packageSelect.value];

    if (!selectedPackage) {
        summaryName.textContent = "لم يتم اختيار باقة بعد";
        summaryPrice.textContent = "اختاري الباقة لعرض السعر المبدئي";
        summaryFeatures.innerHTML = `
            <li>تعبئة البيانات لا تلزمك بالدفع.</li>
            <li>سنراجع التفاصيل قبل تأكيد السعر النهائي.</li>
            <li>يمكن تعديل الطلب أثناء التواصل.</li>
        `;
        return;
    }

    summaryName.textContent = selectedPackage.name;
    summaryPrice.textContent = selectedPackage.price;
    summaryFeatures.innerHTML = selectedPackage.features
        .map((feature) => `<li>${feature}</li>`)
        .join("");
}

function updateOtherOccasionField() {
    const shouldEnable = occasionSelect.value === "أخرى";

    occasionOtherInput.disabled = !shouldEnable;
    occasionOtherInput.required = shouldEnable;

    if (!shouldEnable) {
        occasionOtherInput.value = "";
    }
}

function generateRequestId() {
    const datePart = new Date()
        .toISOString()
        .slice(2, 10)
        .replaceAll("-", "");

    const randomPart = Math.floor(1000 + Math.random() * 9000);

    return `LQ-${datePart}-${randomPart}`;
}

function getFieldValue(fieldName) {
    const field = form.elements[fieldName];
    return field ? field.value.trim() : "";
}

function buildWhatsAppMessage(requestId, normalizedPhone) {
    const selectedPackage = packageDetails[packageSelect.value];
    const services = getSelectedServices();

    const occasion =
        occasionSelect.value === "أخرى"
            ? getFieldValue("occasionOther")
            : occasionSelect.value;

    return [
        "✨ طلب جديد من موقع مداد التحايا",
        "",
        `رقم الطلب: ${requestId}`,
        "حالة الطلب: بانتظار التأكيد",
        "",
        "— بيانات العميلة —",
        `الاسم: ${getFieldValue("fullName")}`,
        `رقم الجوال: ${normalizedPhone}`,
        `المدينة: ${getFieldValue("city") || "غير محددة"}`,
        `الوقت المناسب للتواصل: ${getFieldValue("preferredContactTime") || "غير محدد"}`,
        "",
        "— تفاصيل المناسبة —",
        `نوع المناسبة: ${occasion}`,
        `الأسماء في الدعوة: ${getFieldValue("namesOnInvitation") || "غير محددة"}`,
        `تاريخ المناسبة: ${formatDate(getFieldValue("eventDate"))}`,
        `وقت المناسبة: ${formatTime(getFieldValue("eventTime"))}`,
        `عدد الضيوف المتوقع: ${getFieldValue("guestCount")}`,
        `لغة الدعوة: ${getFieldValue("invitationLanguage")}`,
        "",
        "— الباقة والخدمات —",
        `الباقة: ${selectedPackage.name}`,
        `السعر المبدئي: ${selectedPackage.price}`,
        `الخدمات الإضافية: ${services.length ? services.join("، ") : "لا توجد خدمات إضافية محددة"}`,
        "",
        "— الموقع والتصميم —",
        `اسم المكان: ${getFieldValue("venueName") || "غير محدد"}`,
        `رابط الخرائط: ${getFieldValue("mapLink") || "غير مضاف"}`,
        `طابع التصميم: ${getFieldValue("designStyle") || "يُترك لفريق مداد التحايا"}`,
        `الألوان المفضلة: ${getFieldValue("preferredColors") || "غير محددة"}`,
        `موعد الاستلام المفضل: ${formatDate(getFieldValue("deliveryDate"))}`,
        `رابط مرجعي: ${getFieldValue("referenceLink") || "غير مضاف"}`,
        "",
        "— ملاحظات العميلة —",
        getFieldValue("notes") || "لا توجد ملاحظات إضافية",
        "",
        "أرجو تأكيد استلام الطلب والتواصل معي لإكمال التفاصيل."
    ].join("\n");
}

function saveDraft() {
    const data = {};

    [...form.elements].forEach((field) => {
        if (!field.name) return;

        if (field.type === "checkbox") {
            if (!data[field.name]) data[field.name] = [];
            if (field.checked) data[field.name].push(field.value);
            return;
        }

        data[field.name] = field.value;
    });

    sessionStorage.setItem("medad-tahaya-order-draft", JSON.stringify(data));
}

function restoreDraft() {
    const savedDraft = sessionStorage.getItem("medad-tahaya-order-draft");
    if (!savedDraft) return;

    try {
        const data = JSON.parse(savedDraft);

        Object.entries(data).forEach(([name, value]) => {
            form.querySelectorAll(`[name="${name}"]`).forEach((field) => {
                if (field.type === "checkbox") {
                    field.checked =
                        Array.isArray(value) &&
                        value.includes(field.value);
                } else if (typeof value === "string") {
                    field.value = value;
                }
            });
        });
    } catch (error) {
        console.error("تعذر استعادة مسودة الطلب:", error);
    }
}

restoreDraft();

const packageFromUrl =
    new URLSearchParams(window.location.search).get("package");

if (packageFromUrl && packageDetails[packageFromUrl]) {
    packageSelect.value = packageFromUrl;
}

updatePackageSummary();
updateOtherOccasionField();

packageSelect.addEventListener("change", () => {
    updatePackageSummary();
    saveDraft();
});

occasionSelect.addEventListener("change", () => {
    updateOtherOccasionField();
    saveDraft();
});

form.addEventListener("input", saveDraft);
form.addEventListener("change", saveDraft);

phoneInput.addEventListener("input", () => {
    phoneInput.setCustomValidity("");
});

form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearMessage();

    const normalizedPhone = normalizeSaudiPhone(phoneInput.value);

    if (!normalizedPhone) {
        phoneInput.setCustomValidity(
            "أدخلي رقم جوال سعودي صحيحًا مثل 05XXXXXXXX"
        );
    } else {
        phoneInput.setCustomValidity("");
    }

    if (!form.checkValidity()) {
        form.reportValidity();
        setMessage(
            "يرجى تعبئة الحقول المطلوبة والتأكد من صحة رقم الجوال.",
            true
        );
        return;
    }

    if (
        deliveryDateInput.value &&
        eventDateInput.value &&
        deliveryDateInput.value > eventDateInput.value
    ) {
        deliveryDateInput.focus();
        setMessage(
            "تاريخ استلام الدعوة يجب أن يكون قبل تاريخ المناسبة أو في اليوم نفسه.",
            true
        );
        return;
    }

    const requestId = generateRequestId();
    const message = buildWhatsAppMessage(
        requestId,
        normalizedPhone
    );

    const whatsappUrl =
        `https://wa.me/${BUSINESS_WHATSAPP}` +
        `?text=${encodeURIComponent(message)}`;

    submitButton.disabled = true;
    submitButton.textContent = "جارٍ فتح واتساب...";

    setMessage(
        `تم تجهيز الطلب رقم ${requestId}. أرسلي الرسالة داخل واتساب لإكمال رفع الطلب.`
    );

    sessionStorage.removeItem("medad-tahaya-order-draft");

    const whatsappWindow = window.open(
        whatsappUrl,
        "_blank",
        "noopener,noreferrer"
    );

    if (!whatsappWindow) {
        window.location.href = whatsappUrl;
    }

    window.setTimeout(() => {
        submitButton.disabled = false;
        submitButton.textContent =
            "تأكيد وإرسال الطلب عبر واتساب";
    }, 1500);
});
