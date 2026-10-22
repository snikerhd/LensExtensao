/* ============================================================================
 * site-inject.js — v5.0.0
 * Corre na calculadora OFFSET RP. Recebe o texto extraído do Lens e:
 *   1. recebe INJECT_OCR_TEXT via mensagem (caminho rápido), OU
 *   2. levanta lastExtraction do storage (fallback — TTL alargado para 10 min;
 *      na v4 eram 2 min e expirava durante carregamentos lentos);
 * preenche a textarea de colar (compatível com React) e clica «Processar
 * texto» — com retry até o botão ficar habilitado (na v4 só tentava 1×).
 * ==========================================================================*/
(function () {
  "use strict";

  var TAG = "[SiteInject]";
  var PICKUP_TTL = 10 * 60 * 1000; /* 10 min (antes: 2 min) */
  var filled = false;

  function log() {
    var args = [].slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }
  log("activo em", location.host);

  /* ---------------------------------------------------------- preencher --- */

  function findPasteBox() {
    /* identifica-se pelo placeholder original "1 (0.7)…" */
    var ta = document.querySelector('textarea[placeholder*="1 (0.7)"]');
    if (ta) return ta;
    /* fallback: qualquer textarea visível da página */
    var all = document.querySelectorAll("textarea");
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) return all[i];
    }
    return null;
  }

  function clickProcessar() {
    /* o React demora a habilitar o botão → tenta até conseguir */
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var btns = document.querySelectorAll("button");
      var btn = null;
      for (var i = 0; i < btns.length; i++) {
        var label = (btns[i].textContent || "").trim().toLowerCase();
        if (label === "processar texto" || label.indexOf("processar") === 0) {
          btn = btns[i];
          break;
        }
      }
      if (btn && !btn.disabled) {
        clearInterval(iv);
        btn.click();
        log("'Processar texto' clicado (tentativa " + tries + ").");
        return;
      }
      if (tries >= 20) {
        clearInterval(iv);
        log(
          btn
            ? "botão continua desabilitado — clica manualmente."
            : "botão não encontrado — clica manualmente."
        );
      }
    }, 500);
  }

  function fillBox(text) {
    if (!text) {
      log("sem texto para colar — calculadora aberta em modo manual.");
      return;
    }
    var tries = 0;
    (function attempt() {
      tries++;
      var ta = findPasteBox();
      if (!ta) {
        if (tries < 40) return void setTimeout(attempt, 700);
        return log(
          "textarea de paste não encontrada (aba 'Coimas Rápidas' aberta?)"
        );
      }
      if (filled) return;
      filled = true;

      /* setter nativo + evento input → compatível com React */
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.scrollIntoView({ block: "center", behavior: "smooth" });
      log(
        "texto injectado (" +
          text.split("\n").filter(function (l) {
            return l.trim();
          }).length +
          " linhas)"
      );

      setTimeout(clickProcessar, 450);
    })();
  }

  /* ------------------------------------------------- mensagem direta ------ */

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "INJECT_OCR_TEXT" && msg.text) {
      markConsumed();
      fillBox(msg.text);
    }
  });

  /* -------------------------------------------- fallback via storage ------ */

  function markConsumed() {
    try {
      browser.storage.local.get("lastExtraction").then(function (s) {
        if (s.lastExtraction) {
          s.lastExtraction.consumed = true;
          browser.storage.local.set({ lastExtraction: s.lastExtraction });
        }
      });
    } catch (e) {}
  }

  (function pollStorage() {
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (filled || n > 90) return clearInterval(iv);
      try {
        browser.storage.local.get("lastExtraction").then(function (s) {
          var x = s.lastExtraction;
          if (!x || x.consumed) return;
          if (Date.now() - x.at > PICKUP_TTL) {
            clearInterval(iv);
            x.consumed = true;
            browser.storage.local.set({ lastExtraction: x });
            return;
          }
          clearInterval(iv);
          x.consumed = true;
          browser.storage.local.set({ lastExtraction: x });
          log("levantado do storage (fallback)");
          fillBox(x.text || "");
        });
      } catch (e) {}
    }, 1000);
  })();
})();
