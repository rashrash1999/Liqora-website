(function () {
    "use strict";
    const { PACKAGES, STORAGE_KEYS, formatMoney, formatDate, normalizeSaudiPhone, generateOrderId, store } = window.Medad;
    const form = document.getElementById("order-form");
    const steps = [...form.querySelectorAll(".form-step")];
    const stepperItems = [...document.querySelectorAll("[data-stepper]")];
    const nextButton = document.getElementById("next-step");
    const previousButton = document.getElementById("previous-step");
    const submitButton = document.getElementById("submit-order");
    const alertBox = document.getElementById("form-alert");
    const guestCountInput = form.elements.expectedGuests;
    const phoneInput = form.elements.phone;
    const eventDateInput = form.elements.eventDate;
    let currentStep = 1;

    const today = new Date();
    const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    eventDateInput.min = minDate;

    function formDataObject() {
        const data = Object.fromEntries(new FormData(form).entries());
        data.expectedGuests = Number(data.expectedGuests || 0);
        data.reminderHours = Number(data.reminderHours || 0);
        data.maxCompanions = Number(data.maxCompanions || 0);
        data.addons = [...form.querySelectorAll('input[name="addons"]:checked')].map((input) => input.value);
        return data;
    }

    function saveDraft() { store.set(STORAGE_KEYS.orderDraft, formDataObject()); }

    function restoreDraft() {
        const draft = store.get(STORAGE_KEYS.orderDraft, null);
        if (!draft) return;
        Object.entries(draft).forEach(([name, value]) => {
            form.querySelectorAll(`[name="${name}"]`).forEach((field) => {
                if (field.type === "radio") field.checked = String(field.value) === String(value);
                else if (field.type === "checkbox") field.checked = Array.isArray(value) && value.includes(field.value);
                else if (field.type !== "file" && value !== null) field.value = value;
            });
        });
    }

    function selectedPackage() { return PACKAGES[form.elements.packageId.value] || null; }

    function updateCustomFields() {
        const show = form.elements.packageId.value === "premium";
        document.querySelectorAll(".custom-design-fields").forEach((element) => { element.hidden = !show; });
        form.elements.customNotes.required = show;
    }

    function updateSummary() {
        const pkg = selectedPackage();
        const reminder = Number(form.elements.reminderHours.value || 0);
        const addons = [...form.querySelectorAll('input[name="addons"]:checked')];
        document.getElementById("summary-label").textContent = pkg ? pkg.label : "لم تختر باقة";
        document.getElementById("summary-name").textContent = pkg ? pkg.name : "اختر باقتك للمتابعة";
        document.getElementById("summary-description").textContent = pkg ? pkg.description : "";
        document.getElementById("summary-limit").textContent = pkg ? (pkg.guestLimit ? `حتى ${pkg.guestLimit} مدعو` : "مرن حسب الاتفاق") : "—";
        document.getElementById("summary-reminder").textContent = reminder ? `قبل ${reminder} ساعة` : "—";
        document.getElementById("summary-addons").textContent = addons.length ? `${addons.length} إضافات` : "لا توجد";
        document.getElementById("summary-price").textContent = pkg ? formatMoney(pkg.price) : "—";
        updateCustomFields();
    }

    function showAlert(message) { alertBox.textContent = message; alertBox.hidden = false; }
    function clearAlert() { alertBox.textContent = ""; alertBox.hidden = true; }

    function validateStep() {
        clearAlert();
        const current = steps[currentStep - 1];
        const fields = [...current.querySelectorAll("input,select,textarea")].filter((field) => !field.disabled && !field.closest("[hidden]"));
        if (currentStep === 1) {
            const pkg = selectedPackage();
            if (pkg && pkg.guestLimit && Number(guestCountInput.value) > pkg.guestLimit) {
                guestCountInput.setCustomValidity(`هذه الباقة تدعم حتى ${pkg.guestLimit} مدعو. اختر باقة أعلى أو عدّل العدد.`);
            } else guestCountInput.setCustomValidity("");
        }
        if (currentStep === 2) {
            const normalized = normalizeSaudiPhone(phoneInput.value);
            phoneInput.setCustomValidity(normalized ? "" : "أدخل رقم جوال سعودي صحيحًا مثل 05XXXXXXXX");
        }
        const invalid = fields.find((field) => !field.checkValidity());
        if (invalid) {
            invalid.reportValidity(); invalid.focus();
            showAlert("أكمل الحقول المطلوبة وتأكد من صحة البيانات قبل المتابعة.");
            return false;
        }
        return true;
    }

    function renderReview() {
        const data = formDataObject();
        const pkg = PACKAGES[data.packageId];
        const entries = [
            ["الباقة", pkg.name], ["صاحب الطلب", data.ownerName], ["رقم الجوال", normalizeSaudiPhone(data.phone)], ["المناسبة", data.occasion],
            ["الأسماء في الدعوة", data.honorees], ["الموعد", `${formatDate(data.eventDate)} — ${data.eventTime}`], ["المكان", `${data.venueName}، ${data.city}`],
            ["عدد المدعوين", data.expectedGuests], ["التذكير", `قبل ${data.reminderHours} ساعة`], ["الثيم", data.theme], ["الألوان", data.preferredColors || "يحددها الفريق"], ["الإضافات", data.addons.length ? data.addons.length : "لا توجد"]
        ];
        document.getElementById("review-grid").innerHTML = entries.map(([label, value]) => `<div class="review-item"><span>${label}</span><strong>${String(value)}</strong></div>`).join("");
    }

    function goToStep(nextStep) {
        currentStep = Math.max(1, Math.min(4, nextStep));
        steps.forEach((step, index) => { step.hidden = index + 1 !== currentStep; });
        stepperItems.forEach((item, index) => {
            item.classList.toggle("is-active", index + 1 === currentStep);
            item.classList.toggle("is-complete", index + 1 < currentStep);
            if (index + 1 < currentStep) item.querySelector("b").textContent = "✓";
            else item.querySelector("b").textContent = String(index + 1).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[digit]);
        });
        previousButton.hidden = currentStep === 1;
        nextButton.hidden = currentStep === 4;
        submitButton.hidden = currentStep !== 4;
        if (currentStep === 4) renderReview();
        clearAlert(); window.scrollTo({ top: 0, behavior: "smooth" });
    }

    nextButton.addEventListener("click", () => { if (validateStep()) { saveDraft(); goToStep(currentStep + 1); } });
    previousButton.addEventListener("click", () => goToStep(currentStep - 1));
    form.addEventListener("change", () => { updateSummary(); saveDraft(); });
    form.addEventListener("input", () => { clearAlert(); saveDraft(); });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!validateStep()) return;
        const data = formDataObject();
        const order = { ...data, id: generateOrderId(), phone: normalizeSaudiPhone(data.phone), status: "pending_payment", paid: false, createdAt: new Date().toISOString() };
        store.set(STORAGE_KEYS.currentOrder, order);
        store.remove(STORAGE_KEYS.orderDraft);
        window.location.assign("checkout.html");
    });

    restoreDraft();
    const packageFromUrl = new URLSearchParams(window.location.search).get("package");
    if (packageFromUrl && PACKAGES[packageFromUrl]) {
        const input = form.querySelector(`input[name="packageId"][value="${packageFromUrl}"]`);
        if (input) input.checked = true;
    }
    updateSummary(); goToStep(1);
})();
