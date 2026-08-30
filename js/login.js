(function () {
    "use strict";
    const page = document.body.dataset.loginPage;
    const params = new URLSearchParams(window.location.search);
    const safeReturn = function (fallback) {
        const value = params.get("return");
        return value && /^[a-z0-9_-]+\.html(?:\?.*)?$/i.test(value) ? value : fallback;
    };
    const showError = function (element, message) { element.textContent = message; element.hidden = false; };

    if (page === "admin") {
        if (MedadAuth.isValid("admin")) { window.location.replace(safeReturn("admin.html")); return; }
        const form = document.getElementById("adminLoginForm");
        const email = document.getElementById("adminEmail");
        const password = document.getElementById("adminPassword");
        const error = document.getElementById("adminLoginError");
        document.getElementById("togglePassword").addEventListener("click", function (event) {
            const visible = password.type === "text";
            password.type = visible ? "password" : "text";
            event.currentTarget.textContent = visible ? "إظهار" : "إخفاء";
        });
        form.addEventListener("submit", function (event) {
            event.preventDefault(); error.hidden = true;
            if (email.value.trim().toLowerCase() !== "lolotiga2001@gmail.com" || password.value !== "111000") {
                showError(error, "البريد الإلكتروني أو كلمة المرور غير صحيحة."); return;
            }
            MedadAuth.create("admin", email.value.trim().toLowerCase(), 8);
            window.location.assign(safeReturn("admin.html"));
        });
        return;
    }

    if (MedadAuth.isValid("customer")) { window.location.replace(safeReturn("dashboard.html")); return; }
    const phoneForm = document.getElementById("customerPhoneForm");
    const otpForm = document.getElementById("customerOtpForm");
    const phoneInput = document.getElementById("customerPhone");
    const phoneError = document.getElementById("customerPhoneError");
    const otpError = document.getElementById("customerOtpError");
    const orderPhone = Medad.normalizeSaudiPhone(Medad.store.getCurrentOrder().phone);
    let verifiedPhone = "";
    if (params.get("phone")) phoneInput.value = params.get("phone");

    phoneForm.addEventListener("submit", function (event) {
        event.preventDefault(); phoneError.hidden = true;
        verifiedPhone = Medad.normalizeSaudiPhone(phoneInput.value);
        if (!verifiedPhone) { showError(phoneError, "أدخل رقم جوال سعودي صحيحًا يبدأ بـ05."); return; }
        if (verifiedPhone !== orderPhone) { showError(phoneError, "لا يوجد طلب مرتبط بهذا الرقم في بيانات العرض الحالية."); return; }
        document.getElementById("verificationPhone").textContent = verifiedPhone;
        phoneForm.hidden = true; otpForm.hidden = false;
        document.getElementById("customerOtp").focus();
    });
    document.getElementById("changePhone").addEventListener("click", function () { otpForm.hidden = true; phoneForm.hidden = false; phoneInput.focus(); });
    otpForm.addEventListener("submit", function (event) {
        event.preventDefault(); otpError.hidden = true;
        if (document.getElementById("customerOtp").value.trim() !== "1234") { showError(otpError, "رمز التحقق غير صحيح. استخدم 1234 للعرض التجريبي."); return; }
        MedadAuth.create("customer", verifiedPhone, 24 * 30);
        window.location.assign(safeReturn("dashboard.html"));
    });
})();
