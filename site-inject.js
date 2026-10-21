// site-inject.js — corre no site da calculadora. Recebe o texto do Lens e
// injecta-o no campo "colar texto" (textarea 🅲), disparando o processamento.
(function () {
  console.log("[SiteInject] activo em", location.host);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "INJECT_OCR_TEXT" || !msg.text) return;

    const tryFill = (attempt) => {
      // A textarea de paste identifica-se pelo placeholder "1 (0.7)…"
      const ta = document.querySelector('textarea[placeholder*="1 (0.7)"]');
      if (!ta) {
        if (attempt < 30) setTimeout(() => tryFill(attempt + 1), 700);
        else console.warn("[SiteInject] textarea de paste não encontrada (aba 'Coimas Rápidas' aberta?)");
        return;
      }

      // Preenche de forma compatível com React (setter nativo + evento input)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, msg.text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.scrollIntoView({ block: "center" });
      console.log("[SiteInject] texto injectado (" + msg.text.split("\n").length + " linhas)");

      // Espera o React habilitar o botão e clica "Processar texto"
      setTimeout(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Processar texto"
        );
        if (btn && !btn.disabled) {
          btn.click();
          console.log("[SiteInject] 'Processar texto' clicado");
        } else {
          console.warn("[SiteInject] botão 'Processar texto' não encontrado/desabilitado");
        }
      }, 400);
    };

    tryFill(0);
  });
})();
