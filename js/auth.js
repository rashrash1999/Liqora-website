(function (global) {
    "use strict";
    const KEYS = Object.freeze({ admin: "medad.auth.admin.v1", customer: "medad.auth.customer.v1" });
    const LOGIN_PAGES = Object.freeze({ admin: "admin-login.html", customer: "login.html" });

    function read(role) {
        try { return JSON.parse(global.localStorage.getItem(KEYS[role])); } catch (_) { return null; }
    }
    function isValid(role) {
        const session = read(role);
        if (!session || session.role !== role || Number(session.expiresAt) <= Date.now()) {
            global.localStorage.removeItem(KEYS[role]);
            return false;
        }
        return true;
    }
    function create(role, identity, durationHours) {
        const session = { role, identity, issuedAt: Date.now(), expiresAt: Date.now() + durationHours * 3600000 };
        global.localStorage.setItem(KEYS[role], JSON.stringify(session));
        return session;
    }
    function logout(role) { global.localStorage.removeItem(KEYS[role]); }

    global.MedadAuth = Object.freeze({ KEYS, read, isValid, create, logout });

    const requiredRole = document.body.dataset.auth;
    if (requiredRole) {
        if (!isValid(requiredRole)) {
            const returnTo = `${global.location.pathname.split("/").pop() || "index.html"}${global.location.search}`;
            global.location.replace(`${LOGIN_PAGES[requiredRole]}?return=${encodeURIComponent(returnTo)}`);
            return;
        }
        document.body.classList.add("auth-ready");
    }

    document.querySelectorAll("[data-logout]").forEach(function (control) {
        control.addEventListener("click", function (event) {
            event.preventDefault();
            const role = control.dataset.logout;
            logout(role);
            global.location.assign(LOGIN_PAGES[role] || "index.html");
        });
    });
})(window);
