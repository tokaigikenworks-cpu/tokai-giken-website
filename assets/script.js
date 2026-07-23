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
  const selectedFilesPanel = contactForm.querySelector('.selected-files');
  const selectedFilesSummary = contactForm.querySelector('.selected-files-summary');
  const selectedFilesList = contactForm.querySelector('.selected-files-list');
  const clearFilesButton = contactForm.querySelector('.clear-files');
  const maxFileSize = 10 * 1024 * 1024;
  const maxTotalSize = 20 * 1024 * 1024;
  const maxFileCount = 10;
  const submitLabel = submitButton.textContent;
  let selectedFiles = [];
  let submitting = false;

  const fileKey = (file) => [file.name, file.size, file.type, file.lastModified].join(':');
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const syncFileInput = () => {
    if (!fileInput || typeof DataTransfer === 'undefined') return;
    const transfer = new DataTransfer();
    selectedFiles.forEach((file) => transfer.items.add(file));
    fileInput.files = transfer.files;
  };

  const renderSelectedFiles = () => {
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    selectedFilesPanel.hidden = selectedFiles.length === 0;
    selectedFilesSummary.textContent = `選択済み：${selectedFiles.length}件（合計 ${formatFileSize(totalSize)}）`;
    selectedFilesList.replaceChildren();

    selectedFiles.forEach((file) => {
      const item = document.createElement('li');
      const details = document.createElement('span');
      const name = document.createElement('span');
      const size = document.createElement('span');
      const removeButton = document.createElement('button');

      details.className = 'selected-file-details';
      name.className = 'selected-file-name';
      name.textContent = file.name;
      size.className = 'selected-file-size';
      size.textContent = formatFileSize(file.size);
      removeButton.type = 'button';
      removeButton.className = 'remove-file';
      removeButton.textContent = '削除';
      removeButton.setAttribute('aria-label', `${file.name}を削除`);
      removeButton.addEventListener('click', () => {
        selectedFiles = selectedFiles.filter((selected) => fileKey(selected) !== fileKey(file));
        syncFileInput();
        renderSelectedFiles();
      });

      details.append(name, size);
      item.append(details, removeButton);
      selectedFilesList.append(item);
    });
  };

  const showFileLimitError = () => {
    status.textContent = '添付ファイルは最大10点、1ファイル10MB、合計20MB以内にしてください。';
    status.className = 'form-status error';
    status.setAttribute('role', 'alert');
  };

  fileInput?.addEventListener('change', () => {
    const additions = [...fileInput.files];
    const existingKeys = new Set(selectedFiles.map(fileKey));
    const merged = [...selectedFiles];

    additions.forEach((file) => {
      const key = fileKey(file);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        merged.push(file);
      }
    });

    const totalSize = merged.reduce((sum, file) => sum + file.size, 0);
    if (merged.length > maxFileCount || merged.some((file) => file.size > maxFileSize) || totalSize > maxTotalSize) {
      showFileLimitError();
      syncFileInput();
      return;
    }

    selectedFiles = merged;
    syncFileInput();
    renderSelectedFiles();
    if (status.classList.contains('error')) {
      status.textContent = '';
      status.className = 'form-status';
      status.setAttribute('role', 'status');
    }
  });

  clearFilesButton?.addEventListener('click', () => {
    selectedFiles = [];
    syncFileInput();
    if (fileInput && typeof DataTransfer === 'undefined') fileInput.value = '';
    renderSelectedFiles();
  });

  const renewToken = () => {
    if (token && crypto.randomUUID) token.value = crypto.randomUUID();
  };

  renewToken();

  contactForm.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
  });

  submitButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      status.textContent = '必須項目を入力し、入力内容を確認してください。';
      status.className = 'form-status error';
      status.setAttribute('role', 'alert');
      return;
    }

    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

    if (selectedFiles.length > maxFileCount || selectedFiles.some((file) => file.size > maxFileSize) || totalSize > maxTotalSize) {
      showFileLimitError();
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.textContent = '送信中…';
    status.textContent = '送信しています…';
    status.className = 'form-status';
    status.setAttribute('role', 'status');

    try {
      const requestBody = new FormData(contactForm);
      requestBody.delete('attachment');
      selectedFiles.forEach((file) => requestBody.append('attachment', file, file.name));
      const response = await fetch(contactForm.action, {
        method: 'POST',
        body: requestBody,
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
      submitButton.textContent = submitLabel;
    }
  });
}

const inquiryId = document.querySelector('[data-inquiry-id]');

if (inquiryId) {
  const id = new URLSearchParams(window.location.search).get('id');
  if (id && /^TG-[A-Z0-9-]+$/.test(id)) inquiryId.textContent = `受付番号：${id}`;
}
