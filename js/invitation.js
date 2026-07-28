document.addEventListener("DOMContentLoaded", () => {

    const openBtn = document.getElementById("openInvitationBtn");
    const coverScreen = document.getElementById("coverScreen");
    const bgMusic = document.getElementById("bgMusic");
    const musicBtn = document.getElementById("musicToggle");
    let isPlaying = false;

    if (openBtn) {
        openBtn.addEventListener("click", () => {
            coverScreen.classList.add("hide");
            
            bgMusic.play().then(() => {
                isPlaying = true;
                musicBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            }).catch(err => console.log("تفاعل المستخدم مطلوب لتشغيل الصوت"));
        });
    }

    if (musicBtn) {
        musicBtn.addEventListener("click", () => {
            if (isPlaying) {
                bgMusic.pause();
                musicBtn.innerHTML = '<i class="fa-solid fa-music"></i>';
            } else {
                bgMusic.play();
                musicBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            }
            isPlaying = !isPlaying;
        });
    }

    const weddingDate = new Date("October 21, 2026 20:00:00").getTime();

    function updateCountdown() {
        const now = new Date().getTime();
        const diff = weddingDate - now;

        if (diff > 0) {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (document.getElementById("days")) {
                document.getElementById("days").innerText = days < 10 ? "0" + days : days;
                document.getElementById("hours").innerText = hours < 10 ? "0" + hours : hours;
                document.getElementById("minutes").innerText = minutes < 10 ? "0" + minutes : minutes;
                document.getElementById("seconds").innerText = seconds < 10 ? "0" + seconds : seconds;
            }
        }
    }
    setInterval(updateCountdown, 1000);
    updateCountdown();

    const rsvpForm = document.getElementById("rsvpForm");
    const wishesFeed = document.getElementById("wishesFeed");

    if (rsvpForm) {
        rsvpForm.addEventListener("submit", (e) => {
            e.preventDefault();
            
            const name = document.getElementById("guestName").value;
            const message = document.getElementById("guestMessage").value;

            if (name) {
                const newWish = document.createElement("div");
                newWish.className = "wish-item";
                newWish.innerHTML = `<strong>${name}:</strong><p>${message || 'مبروك للعروسين!'}</p>`;
                
                wishesFeed.prepend(newWish);
                rsvpForm.reset();
                alert("شكراً لك! تم إرسال تأكيدك وتهنئتك بنجاح.");
            }
        });
    }
});
