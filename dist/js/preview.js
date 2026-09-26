import './navigation.js';
const themes = new Set(['classic', 'floral', 'modern']),
  params = new URLSearchParams(location.search);
const art = document.querySelector('#preview-art .invitation-art'),
  names = document.getElementById('preview-names');
let selected = themes.has(params.get('theme')) ? params.get('theme') : 'classic';
function render() {
  art.className = `invitation-art art-${selected}`;
  art.querySelector('strong').textContent = names.value.trim() || 'فرحة تجمعنا';
  document.getElementById('preview-order').href = `order.html?theme=${selected}`;
}
document.querySelectorAll('[name=preview-theme]').forEach((input) => {
  input.checked = input.value === selected;
  input.addEventListener('change', () => {
    selected = input.value;
    render();
  });
});
names.addEventListener('input', render);
document.querySelectorAll('[data-demo-response]').forEach((button) =>
  button.addEventListener('click', () => {
    document.getElementById('demo-response').textContent =
      button.dataset.demoResponse === 'yes'
        ? 'في الدعوة الفعلية يظهر تأكيد الحضور وبطاقة الدخول هنا. هذه تجربة فقط.'
        : 'في الدعوة الفعلية يظهر تأكيد الاعتذار هنا. هذه تجربة فقط.';
  }),
);
render();
