(function () {
    "use strict";

    document.querySelectorAll("[data-current-year], #current-year").forEach((element) => {
        element.textContent = new Date().getFullYear();
    });

    const header = document.querySelector(".site-header");
    const navToggle = document.querySelector(".nav-toggle");
    const nav = document.querySelector(".main-nav");

    const updateHeader = () => header && header.classList.toggle("is-scrolled", window.scrollY > 12);
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();

    if (navToggle && nav) {
        navToggle.addEventListener("click", () => {
            const isOpen = nav.classList.toggle("is-open");
            navToggle.setAttribute("aria-expanded", String(isOpen));
        });
        nav.addEventListener("click", (event) => {
            if (!event.target.closest("a")) return;
            nav.classList.remove("is-open");
            navToggle.setAttribute("aria-expanded", "false");
        });
    }

    const faqItems = [...document.querySelectorAll(".faq-list details")];
    faqItems.forEach((item) => {
        item.addEventListener("toggle", () => {
            if (!item.open) return;
            faqItems.forEach((other) => { if (other !== item) other.removeAttribute("open"); });
        });
    });

    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
        const rel = new Set((link.getAttribute("rel") || "").split(" ").filter(Boolean));
        rel.add("noopener"); rel.add("noreferrer");
        link.setAttribute("rel", [...rel].join(" "));
    });
})();
