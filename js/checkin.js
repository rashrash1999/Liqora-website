(function () {
    "use strict";
    const input = document.getElementById("tokenInput");
    const verifyButton = document.getElementById("verifyButton");
    const checkinButton = document.getElementById("checkinButton");
    const emptyResult = document.getElementById("emptyResult");
    const guestResult = document.getElementById("guestResult");
    const guestStatus = document.getElementById("guestStatus");
    const checkinKey = "medad.checkin.demo-guest-001";
    function setCheckedIn() {
        guestStatus.className = "pill pill-warning";
        guestStatus.textContent = "تم الدخول مسبقًا";
        checkinButton.disabled = true;
        checkinButton.textContent = "مسجّل عند البوابة";
    }
    verifyButton.addEventListener("click", function () {
        if (input.value.trim() !== "demo-guest-001") {
            emptyResult.innerHTML = "<span aria-hidden=\"true\">!</span><h2>الرمز غير صالح</h2><p>تحقق من الرمز أو اطلب من المشرف مراجعة قائمة الضيوف.</p>";
            emptyResult.hidden = false;
            guestResult.hidden = true;
            return;
        }
        emptyResult.hidden = true;
        guestResult.hidden = false;
        if (localStorage.getItem(checkinKey)) setCheckedIn();
    });
    checkinButton.addEventListener("click", function () {
        localStorage.setItem(checkinKey, new Date().toISOString());
        setCheckedIn();
    });
})();
