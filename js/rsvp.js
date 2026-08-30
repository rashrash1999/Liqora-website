(function () {
    "use strict";
    const query = new URLSearchParams(window.location.search);
    const token = query.get("token") || "demo-guest-001";
    const storageKey = `${Medad.STORAGE_KEYS.rsvpPrefix}${token}`;
    const formState = document.getElementById("rsvpFormState");
    const successState = document.getElementById("rsvpSuccessState");
    const form = document.getElementById("rsvpForm");
    const details = document.getElementById("attendanceDetails");
    const guestName = document.getElementById("guestName");
    const error = document.getElementById("rsvpError");

    function showResult(response, isReturning) {
        const attending = response.attendance === "yes";
        formState.hidden = true;
        successState.hidden = false;
        document.getElementById("successTitle").textContent = attending ? "تم تسجيل حضورك" : "تم تسجيل اعتذارك";
        document.getElementById("successMessage").textContent = attending ? "شكرًا لك، نتطلع لرؤيتك ومشاركتنا هذه المناسبة." : "نقدّر ردك، ونتمنى أن نلتقي بك في مناسبة قادمة.";
        document.getElementById("ticketCard").hidden = !attending;
        document.getElementById("ticketGuestName").textContent = response.guestName || "ضيفنا الكريم";
        document.getElementById("closedLinkNote").textContent = isReturning ? "هذا الرابط استُخدم مسبقًا وتم إغلاق نموذج التأكيد." : "تم إغلاق النموذج بعد حفظ ردك بنجاح.";
    }

    const previousResponse = Medad.store.get(storageKey);
    if (previousResponse) showResult(previousResponse, true);

    form.addEventListener("change", function (event) {
        if (event.target.name === "attendance") {
            details.hidden = event.target.value !== "yes";
            guestName.required = event.target.value === "yes";
        }
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        error.hidden = true;
        const data = new FormData(form);
        const attendance = data.get("attendance");
        if (!attendance) {
            error.textContent = "يرجى تحديد الحضور أو الاعتذار قبل الإرسال.";
            error.hidden = false;
            return;
        }
        if (attendance === "yes" && !String(data.get("guestName") || "").trim()) {
            error.textContent = "يرجى كتابة الاسم الذي سيظهر في بطاقة الدخول.";
            error.hidden = false;
            return;
        }
        const response = {
            token,
            attendance,
            guestName: String(data.get("guestName") || "ضيفنا الكريم").trim(),
            companions: attendance === "yes" ? Number(data.get("companions") || 0) : 0,
            message: String(data.get("message") || "").trim(),
            submittedAt: new Date().toISOString()
        };
        Medad.store.set(storageKey, response);
        showResult(response, false);
    });
})();
