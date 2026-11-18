// Belgenin düz metin dışa aktarımını getirir. İçerik betiği yerine burada
// yapılır çünkü dışa aktarım googleusercontent.com'a yönlenebilir ve içerik
// betiğinin fetch'i sayfanın CORS kurallarına tabidir.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ht-export' || !/^[\w-]+$/.test(msg.docId || '')) return false;
  const url = `https://docs.google.com/document/d/${msg.docId}/export?format=txt`;
  fetch(url, { credentials: 'include', cache: 'no-store' })
    .then(async (res) => {
      const text = await res.text();
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('text/plain')) {
        sendResponse({ ok: false, error: `HTTP ${res.status} (${type || 'tür yok'})` });
      } else {
        sendResponse({ ok: true, text });
      }
    })
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // yanıt eşzamansız
});
