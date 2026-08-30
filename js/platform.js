(function (global) {
    "use strict";

    const CONFIG = Object.freeze({
        brandName: "مداد التحايا",
        whatsappNumber: "966537933514",
        currency: "SAR",
        locale: "ar-SA",
        timeZone: "Asia/Riyadh",
        demoMode: true,
        apiBaseUrl: ""
    });

    const PACKAGES = Object.freeze({
        basic: { id: "basic", name: "الباقة الأساسية", label: "جاهزة", price: 199, guestLimit: 100, description: "قالب جاهز وتجهيز سريع" },
        advanced: { id: "advanced", name: "الباقة المتقدمة", label: "مميزة", price: 399, guestLimit: 500, description: "تصاميم مميزة وإدارة أوسع" },
        premium: { id: "premium", name: "الباقة المخصصة", label: "خاصة", price: 699, guestLimit: null, description: "تصميم خاص حسب الطلب" }
    });

    const STORAGE_KEYS = Object.freeze({
        orderDraft: "medad.order.draft.v2",
        currentOrder: "medad.order.current.v2",
        rsvpPrefix: "medad.rsvp.used."
    });

    const DEMO_ORDER = Object.freeze({
        id: "MD-260829-1042",
        ownerName: "سارة محمد",
        phone: "+966 53 793 3514",
        packageId: "advanced",
        occasion: "حفل زفاف",
        honorees: "سارة وعبدالله",
        eventDate: "2026-10-12",
        eventTime: "20:00",
        venueName: "قاعة ليلتي",
        city: "الرياض",
        mapUrl: "https://maps.google.com",
        expectedGuests: 487,
        reminderHours: 48,
        childPolicy: "نعتذر عن استقبال الأطفال",
        status: "ready_to_send",
        paid: true
    });

    function formatMoney(value) {
        return new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency, maximumFractionDigits: 0 }).format(Number(value || 0));
    }

    function formatDate(value, options) {
        if (!value) return "غير محدد";
        const date = new Date(`${value}T12:00:00+03:00`);
        return new Intl.DateTimeFormat(CONFIG.locale, options || { day: "numeric", month: "long", year: "numeric" }).format(date);
    }

    function normalizeSaudiPhone(value) {
        const digits = String(value || "").replace(/\D/g, "");
        if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
        if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
        if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
        return "";
    }

    function generateOrderId() {
        const now = new Date();
        const stamp = now.toISOString().slice(2, 10).replaceAll("-", "");
        const random = global.crypto && global.crypto.getRandomValues
            ? global.crypto.getRandomValues(new Uint16Array(1))[0] % 10000
            : Math.floor(Math.random() * 10000);
        return `MD-${stamp}-${String(random).padStart(4, "0")}`;
    }

    function safeJsonParse(value, fallback) {
        try { return JSON.parse(value); } catch (_) { return fallback; }
    }

    const store = {
        get(key, fallback = null) { return safeJsonParse(global.localStorage.getItem(key), fallback); },
        set(key, value) { global.localStorage.setItem(key, JSON.stringify(value)); return value; },
        remove(key) { global.localStorage.removeItem(key); },
        getCurrentOrder() { return this.get(STORAGE_KEYS.currentOrder, DEMO_ORDER); }
    };

    global.Medad = Object.freeze({ CONFIG, PACKAGES, STORAGE_KEYS, DEMO_ORDER, formatMoney, formatDate, normalizeSaudiPhone, generateOrderId, store });
})(window);
