(function () {
    "use strict";
    const cover = document.getElementById("invitationCover");
    const page = document.getElementById("invitationPage");
    document.getElementById("openInvitation").addEventListener("click", function () {
        page.hidden = false;
        cover.classList.add("is-closed");
        window.setTimeout(function () { cover.hidden = true; }, 750);
        window.scrollTo({ top: 0, behavior: "instant" });
    });
    const eventDate = new Date("2026-10-12T20:00:00+03:00").getTime();
    function updateCountdown() {
        const remaining = Math.max(0, eventDate - Date.now());
        const values = { days: Math.floor(remaining / 86400000), hours: Math.floor((remaining % 86400000) / 3600000), minutes: Math.floor((remaining % 3600000) / 60000), seconds: Math.floor((remaining % 60000) / 1000) };
        Object.entries(values).forEach(function ([id, value]) { document.getElementById(id).textContent = String(value).padStart(2, "0"); });
    }
    updateCountdown();
    window.setInterval(updateCountdown, 1000);
})();
