/* ============================================================================
 * site-inject.js — v5.7.0
 * v5.7.0: parser escolhe o bloco com mais linhas de inventário (":", munições,
 *         acessórios) e filtra lixo de resultados relacionados (apps, guias,
 *         battle pass). Antes, um bloco pequeno de lixo (2 linhas) vencia o
 *         inventário real só por ser o primeiro.
 * v5.6.0: FIX — A extensão entregava o mesmo texto duas vezes (mensagem direta
 *         + fallback por storage), o que duplicava o parser no Relatório.
 *         Agora entregas idênticas em menos de 4s são ignoradas.
 * v5.1.2: FIX — Removida a variável "filled" que impedia a injeção de texto
 *         na segunda vez que se usava o Lens sem recarregar a página.
 * ==========================================================================*/
(function () {
  "use strict";

  var TAG = "[SiteInject]";
  var VERSION = "5.7.0";
  var PICKUP_TTL = 10 * 60 * 1000;
  // Última entrega, para não preencher/clicar duas vezes com o mesmo texto.
  var lastDelivery = { text: "", at: 0 };

  function log() {
    var args = [].slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }
  log("activo em", location.host, "(v" + VERSION + ")");

  /* ---------------------------------------------------------- preencher --- */

  function findPasteBox() {
    var ta = document.querySelector('textarea[placeholder*="1 (0.7)"]');
    if (ta && ta.offsetParent !== null) return ta;
    
    var all = document.querySelectorAll("textarea");
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) return all[i];
    }
    if (ta) return ta;
    return null;
  }

  function clickProcessar() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var btns = document.querySelectorAll("button");
      var btn = null;
      for (var i = 0; i < btns.length; i++) {
        var label = (btns[i].textContent || "").trim().toLowerCase();
        if (
          btns[i].offsetParent !== null &&
          !btns[i].disabled &&
          (label === "processar texto" || label.indexOf("processar") === 0)
        ) {
          btn = btns[i];
          break;
        }
      }
      if (btn) {
        clearInterval(iv);
        btn.click();
        log("'Processar texto' clicado (tentativa " + tries + ").");
        return;
      }
      if (tries >= 20) {
        clearInterval(iv);
        log("botão 'Processar texto' visível não encontrado — clica manualmente.");
      }
    }, 500);
  }

  function fillBox(text) {
    if (!text) {
      log("sem texto para colar — calculadora aberta em modo manual.");
      return;
    }
    // Mensagem direta e fallback por storage podem chegar quase juntos.
    // Ignora a segunda entrega do MESMO texto para não duplicar o parser.
    var now = Date.now();
    if (text === lastDelivery.text && now - lastDelivery.at < 4000) {
      log("entrega duplicada ignorada (mensagem + storage)");
      return;
    }
    lastDelivery = { text: text, at: now };
    var tries = 0;
    (function attempt() {
      tries++;
      var ta = findPasteBox();
      if (!ta) {
        if (tries < 40) return void setTimeout(attempt, 700);
        return log("textarea de paste não encontrada (aba errada?).");
      }

      // [FIX] Já não há "if (filled) return;". Preenche sempre!
      
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

  browser.runtime.onMessage.addListener(function (msg) {
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
      // [FIX] Removemos a verificação "filled ||"
      if (n > 90) return clearInterval(iv);
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

  /* ─────────────────────────────────────────────────────────────────────
   * Ponte site → extensão
   * ───────────────────────────────────────────────────────────────────── */

  try {
    document.documentElement.setAttribute("data-offset-ext", "1");
  } catch (e) {}

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    if (!ev.data || ev.data.type !== "OFFSET_LENS_EXTRACT") return;

    var imageUrl = String(ev.data.url || "").trim();
    var query = String(ev.data.query || "").trim();
    if (!imageUrl) return;

    log("pedido do site → abrir Lens:", imageUrl);

    try {
      browser.runtime.sendMessage({
        type: "LENS_SEARCH_IMAGE",
        url: imageUrl,
        query: query || undefined
      }).then(function (resp) {
        log("background respondeu:", resp);
      }).catch(function (e) {
        log("sendMessage (promise) falhou:", e);
      });
    } catch (e) {
      log("sendMessage falhou:", e);
    }
  });

  log("ponte site↔extensão ativa (data-offset-ext=1)");
})();