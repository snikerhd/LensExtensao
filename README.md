# Offset RP — Lens AI Extractor v4.0.0 (corrigido)

Extensão para **Firefox** que abre uma imagem no Google Lens, anexa
automaticamente a *query multimodal* (exatamente como quando escreves na caixa
de pesquisa do Lens à mão), extrai a lista `nome - quantidade` do AI Overview
e cola-a na calculadora OFFSET RP.

## O que estava partido na versão antiga

| Problema | Efeito |
|---|---|
| `lens-extract.js` com **5× `const input`** no mesmo scope + seletores inválidos (`"...q\"])"`) + regex com `)?` a mais | **SyntaxError no parse → o script nunca corria**. Era por isto que "não dava". |
| Regex com `\\s`, `\\d` dentro de literais `/.../` | Procuravam um *backslash* literal — **nunca faziam match** |
| `QUERY` e `queryFeida` usados sem serem declarados | ReferenceError |
| Tentar "escrever" na caixa do Lens com eventos sintéticos | Frágil — o React do Google ignorava a maioria das tentativas |

## O que muda agora

1. Abres `lens.google.com/uploadbyurl?url=<imagem>` (popup ou clique direito).
2. O Google redireciona para `google.com/search?...&source=lns.web.ukn&vsrid=...`.
3. O content script **anexa a query ao próprio URL** (`&q=...&sclient=multimodal-lens-web`)
   e recarrega — é o mesmo pedido que o Google faz quando submetes na caixa.
4. O AI Overview responde com a lista; o parser extrai `Nome - quantidade`
   (também aceita `Nome (x12)`, `Nome x12` e `12x Nome`), estabiliza e envia.
5. O `background.js` abre a calculadora e o `site-inject.js` cola o texto e
   clica em **Processar texto** (com fallback via storage se a página demorar).

## Instalar (Firefox)

Temporária (desaparece ao fechar o browser):
1. `about:debugging` → **Este Firefox** → **Carregar extensão temporária…**
2. Escolhe o ficheiro `manifest.json` desta pasta.

Permanente (Firefox Developer Edition / Nightly):
1. `about:config` → `xpinstall.signatures.required` → **false**
2. Compacta esta pasta em ZIP e instala em `about:addons` → roda dentada →
   **Instalar de um ficheiro…**

## Como usar

- **Clique direito numa imagem** → *Extrair itens com Lens (Offset RP)*, ou
- Abre o popup (ícone na barra), cola o link da imagem e clica **Abrir Lens & Extrair**.

A query multimodal é editável e fica guardada. Predefinição:

> Consegues meter nome - quantidade arma- municao acessorios- quantidade na
> imagem se aparecer acessorios mete so o numero petrocal se tiver numero em
> cima ignora e so 1

## Notas

- O "sinal" de que uma sessão Lens veio da extensão dura **3 minutos** — se
  demorares mais do que isso numa página de consentimento, volta a lançar.
- Se o AI Overview não aparecer (nem sempre a Google o mostra), recebes uma
  notificação e a imagem fica aberta — podes submeter a query à mão na caixa
  da imagem e a extensão extrai quando aparecer.
- Chrome/Edge: este manifesto é **MV2 (Firefox)**. Para Chromium seria preciso
  portar para MV3 (service worker + `chrome.*`).
