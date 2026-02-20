// Runs in extension tab — showDirectoryPicker works here
document.getElementById('btn-save').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = '';
  status.className = '';

  const { savePayload } = await chrome.storage.session.get('savePayload');
  if (!savePayload) {
    status.textContent = 'No data to save. Generate and Save from DevTools panel first.';
    status.className = 'error';
    return;
  }

  const { testName, code, mocks } = savePayload;

  if (!('showDirectoryPicker' in window)) {
    status.textContent = 'Folder picker not supported in this browser.';
    status.className = 'error';
    return;
  }

  try {
    const handle = await showDirectoryPicker();
    const testFilename = (testName || 'recorded-test').replace(/\.(spec\.(js|ts))?$/i, '') + '.spec.js';

    const testHandle = await handle.getFileHandle(testFilename, { create: true });
    const testWritable = await testHandle.createWritable();
    await testWritable.write(code || '');
    await testWritable.close();

    const mocksDir = await handle.getDirectoryHandle('mocks', { create: true });
    for (const m of mocks || []) {
      const base = (m.filename || 'mock').replace(/[^a-zA-Z0-9_.-]/g, '_');
      const filename = base + (base.endsWith('.json') ? '' : '.json');
      const body = m.body != null ? (typeof m.body === 'string' ? m.body : JSON.stringify(m.body)) : '{}';
      const fileHandle = await mocksDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(body);
      await writable.close();
    }

    status.textContent = `Saved: ${testFilename}${(mocks || []).length ? ' + ' + mocks.length + ' mocks' : ''}`;
    status.className = 'success';
    chrome.storage.session.remove('savePayload');
  } catch (e) {
    if (e.name !== 'AbortError') {
      status.textContent = e?.message || 'Save failed';
      status.className = 'error';
    }
  }
});
