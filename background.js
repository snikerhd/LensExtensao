// background.js — cérebro da extensão (fluxo sem popup dependente)
const SITE_URL = "https://offsetrp-calculadora.vercel.app";

// Abre a calculadora e injecta o texto extraído no campo "colar texto".
async function deliverToSite(text) {
  const tab = await browser.tabs.create({ url: SITE_URL, active: true });
  // Espera o content script do site estar pronto e injecta (com retries).
  const tryInject = async (attempt) => {
    try {
      await browser.tabs.sendMessage(tab.id, { type: "INJECT_OCR_TEXT", text });
    } catch {
      if (attempt < 10) setTimeout(() => tryInject(attempt + 1), 1000);
      else notify("OCR", "Abre a aba 'Coimas Rápidas' e cola o texto manualmente (campo 🅲).");
    }
  };
  setTimeout(() => tryInject(0), 1500);
}

function notify(title, message) {
  try { browser.notifications.create({ type: "basic", title, message }); } catch {}
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script (Lens) extraiu os itens
  if (msg.type === "LENS_TEXT_EXTRACTED") {
    console.log("[BG] Extraídos " + msg.text.split("\n").length + " itens, a entregar no site...");
    notify("✅ Itens extraídos", msg.text.split("\n").length + " itens do Lens. A abrir a calculadora...");
    deliverToSite(msg.text);
    sendResponse({ status: "ok" });
    return true;
  }

  // Content script (Lens) falhou
  if (msg.type === "LENS_TEXT_FAILED") {
    console.warn("[BG] Extracção falhou");
    notify("❌ Lens", "O AI Overview não apareceu. Tenta outra imagem ou cola o texto manualmente.");
    sendResponse({ status: "ok" });
  }

  return false;
});
