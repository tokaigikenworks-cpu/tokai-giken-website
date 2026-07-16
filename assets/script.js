const menuButton = document.querySelector('.menu-button');
const header = document.querySelector('.site-header');

if (menuButton && header) {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.addEventListener('click', () => {
    const isOpen = header.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
}

const contactForm = document.querySelector('form[action="/api/contact"]');

if (contactForm) {
  const submitButton = contactForm.querySelector('.submit');
  const status = contactForm.querySelector('.form-status');
  const token = contactForm.querySelector('[name="submission_token"]');
  const fileInput = contactForm.querySelector('[name="attachment"]');
  const maxFileSize = 10 * 1024 * 1024;
  const maxTotalSize = 20 * 1024 * 1024;
  const maxFileCount = 10;
  let submitting = false;

  const renewToken = () => {
    if (token && crypto.randomUUID) token.value = crypto.randomUUID();
  };

  renewToken();

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !contactForm.reportValidity()) return;

    const files = [...(fileInput?.files || [])];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    if (files.length > maxFileCount || files.some((file) => file.size > maxFileSize) || totalSize > maxTotalSize) {
      status.textContent = '添付ファイルは最大10点、1ファイル10MB、合計20MB以内にしてください。';
      status.className = 'form-status error';
      status.setAttribute('role', 'alert');
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    status.textContent = '送信しています…';
    status.className = 'form-status';
    status.setAttribute('role', 'status');

    try {
      const response = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || '送信できませんでした。時間をおいて再度お試しください。');
      }

      const query = result.inquiryId ? `?id=${encodeURIComponent(result.inquiryId)}` : '';
      window.location.assign(`contact-complete.html${query}`);
    } catch (error) {
      status.textContent = error.message;
      status.className = 'form-status error';
      status.setAttribute('role', 'alert');
      submitting = false;
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
  });
}

const inquiryId = document.querySelector('[data-inquiry-id]');

if (inquiryId) {
  const id = new URLSearchParams(window.location.search).get('id');
  if (id && /^TG-[A-Z0-9-]+$/.test(id)) inquiryId.textContent = `受付番号：${id}`;
}
