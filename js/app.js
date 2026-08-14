"use strict";

const qs = (selector, context = document) => context.querySelector(selector);
const qsa = (selector, context = document) => [...context.querySelectorAll(selector)];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const yearElement = qs("#current-year");
if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
}

const progressBar = document.createElement("div");
progressBar.className = "page-progress";
progressBar.setAttribute("aria-hidden", "true");
document.body.appendChild(progressBar);

const updateProgress = () => {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
    progressBar.style.width = `${Math.min(progress, 100)}%`;
};

window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);
updateProgress();

const header = qs(".header");
const updateHeader = () => {
    if (header) {
        header.classList.toggle("is-scrolled", window.scrollY > 20);
    }
};
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    const glow = document.createElement("div");
    glow.className = "cursor-glow";
    glow.setAttribute("aria-hidden", "true");
    document.body.appendChild(glow);

    let glowX = window.innerWidth / 2;
    let glowY = window.innerHeight / 2;
    let targetX = glowX;
    let targetY = glowY;

    window.addEventListener("pointermove", (event) => {
        targetX = event.clientX;
        targetY = event.clientY;
        glow.style.opacity = "1";
    });

    const animateGlow = () => {
        glowX += (targetX - glowX) * 0.12;
        glowY += (targetY - glowY) * 0.12;
        glow.style.transform = `translate(${glowX - 170}px, ${glowY - 170}px)`;
        requestAnimationFrame(animateGlow);
    };

    animateGlow();
}

const revealElements = [
    ...qsa(".hero-content"),
    ...qsa(".section-label"),
    ...qsa("section h2"),
    ...qsa(".section-description"),
    ...qsa(".feature-card"),
    ...qsa(".package-card"),
    ...qsa(".step-card"),
    ...qsa(".faq-item"),
    ...qsa(".contact-content"),
    ...qsa(".footer-brand"),
    ...qsa(".footer-links"),
    ...qsa(".legal-card")
];

revealElements.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.setProperty("--delay", `${Math.min((index % 6) * 70, 280)}ms`);
});

if ("IntersectionObserver" in window && !reduceMotion) {
    const observer = new IntersectionObserver(
        (entries, currentObserver) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                currentObserver.unobserve(entry.target);
            });
        },
        { threshold: 0.12, rootMargin: "0px 0px -45px" }
    );

    revealElements.forEach((element) => observer.observe(element));
} else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
}

if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    qsa(".feature-card, .step-card, .package-card").forEach((card) => {
        card.addEventListener("pointermove", (event) => {
            const rect = card.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const rotateY = ((x / rect.width) - 0.5) * 7;
            const rotateX = ((y / rect.height) - 0.5) * -7;

            card.style.setProperty("--rotate-x", `${rotateX.toFixed(2)}deg`);
            card.style.setProperty("--rotate-y", `${rotateY.toFixed(2)}deg`);
            card.style.setProperty("--mx", `${(x / rect.width) * 100}%`);
            card.style.setProperty("--my", `${(y / rect.height) * 100}%`);
        });

        card.addEventListener("pointerleave", () => {
            card.style.setProperty("--rotate-x", "0deg");
            card.style.setProperty("--rotate-y", "0deg");
            card.style.setProperty("--mx", "50%");
            card.style.setProperty("--my", "50%");
        });
    });
}

qsa(".header-button, .primary-button, .secondary-button").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
        const oldRipple = qs(".ripple", button);
        if (oldRipple) oldRipple.remove();

        const rect = button.getBoundingClientRect();
        const ripple = document.createElement("span");
        ripple.className = "ripple";
        ripple.style.left = `${event.clientX - rect.left}px`;
        ripple.style.top = `${event.clientY - rect.top}px`;

        button.appendChild(ripple);
        ripple.addEventListener("animationend", () => ripple.remove());
    });
});

const faqItems = qsa(".faq-item");
faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
        if (!item.open) return;

        faqItems.forEach((otherItem) => {
            if (otherItem !== item) {
                otherItem.removeAttribute("open");
            }
        });
    });
});

qsa('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
        const targetId = link.getAttribute("href");
        if (!targetId || targetId === "#") return;

        const target = qs(targetId);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "start"
        });
    });
});

const campaignParameters = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "ttclid",
    "fbclid",
    "gclid"
];

const currentParameters = new URLSearchParams(window.location.search);

campaignParameters.forEach((parameterName) => {
    const value = currentParameters.get(parameterName);
    if (value) {
        sessionStorage.setItem(parameterName, value);
    }
});

qsa('a[href*="wa.me/966537933514"]').forEach((link) => {
    try {
        const whatsappUrl = new URL(link.href);
        const originalMessage =
            whatsappUrl.searchParams.get("text") ||
            "مرحباً، أرغب في الاستفسار عن خدمات مداد التحايا";

        const campaignData = campaignParameters
            .map((parameterName) => {
                const savedValue = sessionStorage.getItem(parameterName);
                return savedValue ? `${parameterName}: ${savedValue}` : null;
            })
            .filter(Boolean);

        const fullMessage = campaignData.length
    ? `${originalMessage}\n\nمصدر الزيارة:\n${campaignData.join("\n")}`
    : originalMessage;

        whatsappUrl.searchParams.set("text", fullMessage);
        link.href = whatsappUrl.toString();
    } catch (error) {
        console.error("تعذر تحديث رابط واتساب:", error);
    }
});

qsa('a[target="_blank"]').forEach((link) => {
    const relValues = new Set((link.getAttribute("rel") || "").split(" ").filter(Boolean));
    relValues.add("noopener");
    relValues.add("noreferrer");
    link.setAttribute("rel", [...relValues].join(" "));
});

console.log("تم تشغيل تصميم مداد التحايا العصري بنجاح");
