import './navigation.js';
import { PACKAGES } from './domain.js';
const input = document.getElementById('package-guests'),
  message = document.getElementById('package-recommendation'),
  error = document.getElementById('package-error');
function update() {
  const count = Number(input.value),
    valid = Number.isInteger(count) && count >= 1 && count <= 10000;
  error.hidden = valid;
  error.textContent = valid ? '' : 'اختر عددًا صحيحًا من ١ إلى ١٠٠٠٠ دعوة.';
  input.setAttribute('aria-invalid', String(!valid));
  const recommended = valid
    ? count <= 100
      ? 'basic'
      : count <= 500
        ? 'advanced'
        : 'premium'
    : null;
  message.textContent = valid
    ? `${new Intl.NumberFormat('ar-SA').format(count)} دعوة · ${PACKAGES[recommended].name} تناسبك`
    : 'راجع عدد الدعوات للمتابعة';
  document.querySelectorAll('[data-package-link]').forEach((link) => {
    const id = link.dataset.packageLink,
      suitable = valid && count <= PACKAGES[id].guestLimit;
    link.setAttribute('aria-disabled', String(!suitable));
    if (suitable) {
      link.href = `order.html?${new URLSearchParams({ package: id, guests: String(count) })}`;
      link.removeAttribute('tabindex');
    } else {
      link.removeAttribute('href');
      link.tabIndex = -1;
    }
    document.querySelector(`[data-package="${id}"]`).classList.toggle('is-unsuitable', !suitable);
  });
  document.querySelectorAll('[data-recommended]').forEach((n) => {
    n.hidden = n.dataset.recommended !== recommended;
  });
  document.getElementById('guest-minus').disabled = valid && count <= 1;
  document.getElementById('guest-plus').disabled = valid && count >= 10000;
}
document.getElementById('guest-minus').addEventListener('click', () => {
  input.value = String(Math.max(1, (Number(input.value) || 1) - 25));
  update();
});
document.getElementById('guest-plus').addEventListener('click', () => {
  input.value = String(Math.min(10000, (Number(input.value) || 0) + 25));
  update();
});
input.addEventListener('input', update);
document.querySelectorAll('[data-price]').forEach((n) => {
  n.textContent = new Intl.NumberFormat('ar-SA').format(PACKAGES[n.dataset.price].price);
});
document.querySelectorAll('[data-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
      other.classList.toggle('is-selected', other === button);
    });
    document.querySelectorAll('[data-category]').forEach((card) => {
      card.hidden =
        button.dataset.filter !== 'all' && button.dataset.filter !== card.dataset.category;
    });
  }),
);
update();
