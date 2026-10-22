# Offset RP — Lens AI Extractor **v5.2.0** (corrigido)

> **v5.2.0:** o «falta clicar o botão de search» está resolvido a sério. O botão do Lens **não tem aria-label nem texto** — é só o ícone Material de lupa. A extensão identifica-o pelo **path do próprio SVG** (`M784-120…`), procura-o primeiro dentro do contentor da caixa e depois na página inteira, e **retenta a submissão até 10×** se o clique não navegar à primeira. A caixa certa também é escolhida pela proximidade ao botão (não textareas escondidas de outros widgets).

> **v5.1.0:** submissão automática (botão → Enter sintético → `form.requestSubmit()`), navegação SPA para `/search` detetada no mesmo documento.

Extensão para **Firefox** que abre uma imagem no Google Lens, anexa automaticamente a query multimodal, extrai a lista `nome - quantidade` do AI Overview e cola-a na calculadora OFFSET RP — abrindo sempre o site no fim.

## Sintomas reportados → correções desta versão

| Sintoma | Causa na v4.0.0 | Correção v5 |
| --- | --- | --- |
| «Às vezes falha a pesquisa» | O sinal «veio da extensão» era um timestamp com TTL de **3 minutos**; se demorasses na página de consentimento, a query já não era anexada ao URL e a pesquisa morria silenciosamente | O sinal é agora um objecto `{at, url, query}` com TTL de **15 minutos**, gravado com `await` **antes** de abrir a aba |
| «Às vezes falha a pesquisa» (2) | A deteção de sessão Lens dependia de parâmetros rígidos (`source=lns.web.ukn` etc.) e só corria em `document_idle` | Heurística alargada (`lns`, `vsrid`, `ludocid`, `udm=24`, referrer do Lens) e o script corre em **`document_start`**, anexando a query antes da pintura |
| «Depois não abre o site» | A calculadora **só abria se a extração corre-se bem**; em falha ficava tudo parado com uma notificação | O site abre **sempre**: sucesso → texto colado; parcial → envia o que apanhaste; falha → abre a calculadora para colares à mão. O texto é **sempre copiado para a área de transferência** como rede de segurança |
| «Falta carregar no Enter» | Na página do Lens, o texto ficava escrito na caixa mas a pesquisa nunca era submetida automaticamente | A caixa é preenchida (se vazia) e **submetida pela extensão**: clique no botão de pesquisa → Enter sintético → `form.requestSubmit()`. Se o Google pré-preencher o texto, a extensão só submete |
| «O botão de search não é clicado» | O botão do Lens é só um ícone SVG (lupa Material) — sem `aria-label`, por isso nenhum seletor o apanhava | Botão identificado pelo **path do SVG** (`M784-120…`) dentro do contentor da caixa, com fallback global e **retentativa até 10×** |
| Separadores duplicados | Cada extração abria um separador novo | Reutiliza/recarrega a aba da calculadora |
| Texto nem sempre colado | Mensagens disparadas às cegas 1,5 s depois de criar a aba | Injeção só arranca depois do evento `onUpdated=complete`, com 12 retries + fallback automático via storage (TTL de pickup alargado para 10 min) |

O popup **continua a pedir o link da imagem** (esse fluxo não mudou) e ganhou um botão «Colar» que lê diretamente a área de transferência.

## Instalar (Firefox)

Temporária (desaparece ao fechar o browser):

1. `about:debugging` → **Este Firefox** → **Carregar extensão temporária…**
2. Escolhe o ficheiro `manifest.json` desta pasta.

Permanente (Firefox Developer Edition / Nightly):

1. `about:config` → `xpinstall.signatures.required` → **false**
2. Compacta esta pasta em ZIP e instala em `about:addons` → roda dentada → **Instalar de um ficheiro…**.

## Como usar

- **Popup** (ícone na barra): cola o link da imagem (ou prime «Colar»), edita a query se quiseres, clica **Abrir Lens & Extrair** — ou prime Enter.
- **Clique direito numa imagem** → *Extrair itens com Lens (Offset RP)*.

Query multimodal predefinida (editável, fica guardada):

> Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1

## Notas

- Se o AI Overview não aparecer (nem sempre o Google o mostra), a calculadora abre na mesma e recebes o que houver na área de transferência.
- Formatos aceites: `Nome - 12`, `Nome (x12)`, `Nome x12` e `12x Nome`, com ou sem bullets/negrito Markdown.
- Chrome/Edge: este manifesto é **MV2 (Firefox)**.
