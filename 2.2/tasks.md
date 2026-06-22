## T01 — Setup do endpoint `POST /api/query` + validação de input (`src/functions/query/handler.ts`, `src/functions/query/validator.ts`)
**Descrição:** Registrar o HTTP trigger (Azure Functions v4) para `POST /api/query` e validar o corpo
da requisição (`{ question: string }`) com Zod. Em input válido, retornar um stub (`501 Not Implemented`)
para permitir rodar o endpoint de ponta a ponta desde já; em input inválido, retornar `400`.
O schema Zod é a fonte da verdade do contrato de entrada — o tipo `QueryRequest` é inferido aqui e
consolidado depois em `src/shared/types.ts` (T02).

**Critérios de aceite:**
- [ ] HTTP trigger Azure Functions v4 registrado para `POST /api/query` e o app sobe sem erros.
- [ ] `validator.ts` exporta schema Zod e `parseQueryRequest(body): QueryRequest`.
- [ ] `question` vazia, ausente, não-string ou acima do limite máximo de tamanho → `400` (corpo de erro, sem stack).
- [ ] Input válido → `501` (placeholder) até a T12 ligar o pipeline.
- [ ] Teste cobre input válido e ao menos 3 inputs inválidos, validando os status retornados.

**Dependências:** —
**Tamanho:** M

---

## T02 — Tipos de domínio (`src/shared/types.ts`)
**Descrição:** Definir os tipos/contratos compartilhados do fluxo: `QueryRequest`, `QueryResponse`,
`Chunk` (com metadado de vigência — ADR-0003), `SearchResult`, `PromptParts` e `CompletionResult`.
Consolidar/alinhar `QueryRequest` com o schema definido na T01.

**Critérios de aceite:**
- [ ] `src/shared/types.ts` exporta os tipos acima e `tsc -p .` compila sem erros.
- [ ] `Chunk` inclui `sourceDocument: string` e campo de vigência (ex.: `effectiveDate`/`expiresAt`).
- [ ] `QueryResponse` inclui `answer: string` e `sourceDocument: string`.
- [ ] `QueryRequest` é compatível com o schema Zod da T01.
- [ ] Nenhum `any` exportado (validável via `npm run lint`).

**Dependências:** T01
**Tamanho:** P

---

## T03 — Configuração e env (`src/shared/config.ts`)
**Descrição:** Carregar e validar variáveis de ambiente (endpoints/keys de Azure OpenAI e Azure AI Search,
deployment do GPT-4o e do modelo de embeddings, `topK=5`, limites de budget) com Zod, falhando no boot.

**Critérios de aceite:**
- [ ] Exporta um objeto `config` tipado, validado por um schema Zod.
- [ ] Variável ausente/inválida lança erro descritivo (não retorna `undefined`).
- [ ] Constantes de budget expostas: `SYSTEM_TOKEN_BUDGET≈4000` e `CHUNKS_TOKEN_BUDGET≈8000` (ADR-0002).
- [ ] Teste unitário cobre caso válido e caso de env ausente.

**Dependências:** —
**Tamanho:** P

---

## T04 — Taxonomia de erros (`src/shared/errors.ts`)
**Descrição:** Classes de erro de domínio (`ValidationError`, `SearchError`, `CompletionError`,
`UpstreamTimeoutError`) com mapeamento para status HTTP.

**Critérios de aceite:**
- [ ] Cada classe estende `Error`, tem `name` próprio e `statusCode` associado (400/502/504).
- [ ] Helper `toHttpError(err)` retorna `{ status, body }` sem vazar stack/segredos.
- [ ] Teste unitário verifica o mapeamento de cada erro para o status correto.

**Dependências:** —
**Tamanho:** P

---

## T05 — Logger estruturado (`src/shared/logger.ts`)
**Descrição:** Configurar pino para logging estruturado (JSON), com `requestId` correlacionável.

**Critérios de aceite:**
- [ ] Exporta `logger` (pino) e função para criar child logger com `requestId`.
- [ ] Nível de log lido de env (default `info`).
- [ ] Nenhum `console.log` no projeto (validável via `npm run lint` / grep).

**Dependências:** —
**Tamanho:** P

---

## T06 — Utilitário de retry com backoff (`src/shared/retry.ts`)
**Descrição:** Helper genérico `withRetry(fn, opts)` com exponential backoff para chamadas Azure.
Utilitário compartilhado por search (T08) e completion (T10) — mantido como tarefa própria por ser
infraestrutura transversal a mais de um passo.

**Critérios de aceite:**
- [ ] Re-tenta apenas erros transitórios (5xx/429/timeout); erros 4xx não são re-tentados.
- [ ] Backoff exponencial com nº máximo de tentativas configurável (default 3).
- [ ] Teste unitário (com fake timers) prova: sucesso após falha transitória e desistência após o máximo.

**Dependências:** T04
**Tamanho:** P

---

## T07 — System prompt versionado (`prompts/system-prompt.md`)
**Descrição:** Finalizar o system prompt do assistente (tom, escopo, regra de citar `source_document`,
tratamento de documentos contraditórios por vigência — ADR-0003).

**Critérios de aceite:**
- [ ] Arquivo `prompts/system-prompt.md` existe e instrui o modelo a citar o documento-fonte.
- [ ] Inclui regra explícita de priorizar o documento vigente em caso de conflito.
- [ ] Cabe no orçamento de ~4K tokens (validável no teste da T09).

**Dependências:** —
**Tamanho:** P

---

## T08 — Serviço de busca/embeddings (`src/services/search.ts`)
**Descrição:** Converter pergunta em embedding (Azure OpenAI) e buscar top-5 chunks no Azure AI Search,
retornando `SearchResult[]` com `sourceDocument` e metadado de vigência.

**Critérios de aceite:**
- [ ] Função `searchChunks(question): Promise<SearchResult[]>` retorna no máximo `topK=5` resultados.
- [ ] Chamadas a Azure usam `withRetry` (T06).
- [ ] Erros de upstream são convertidos em `SearchError` (T04).
- [ ] Teste unitário com cliente Azure mockado cobre: 5 resultados, lista vazia e erro de upstream.

**Dependências:** T02, T03, T04, T05, T06
**Tamanho:** M

---

## T09 — Montagem de prompt com budget (`src/services/prompt-builder.ts`)
**Descrição:** Montar mensagens (system + chunks + pergunta) respeitando o budget de contexto
(~4K system + ~8K chunks); truncar/descartar chunks excedentes preservando os de maior score e vigentes.

**Critérios de aceite:**
- [ ] `buildPrompt(systemPrompt, chunks, question): PromptParts` nunca excede `CHUNKS_TOKEN_BUDGET` para os chunks.
- [ ] Quando os chunks excedem o budget, os de menor relevância são removidos (não a pergunta nem o system).
- [ ] Cada chunk incluído mantém referência ao `sourceDocument`.
- [ ] Teste unitário prova o corte quando o total estoura o budget (e valida o ~4K do system prompt da T07).

**Dependências:** T02, T03, T07
**Tamanho:** M

---

## T10 — Serviço de completion GPT-4o (`src/services/completion.ts`)
**Descrição:** Enviar `PromptParts` ao GPT-4o (Azure OpenAI) e retornar a resposta do modelo.

**Critérios de aceite:**
- [ ] `complete(promptParts): Promise<CompletionResult>` retorna o texto da resposta do modelo.
- [ ] Usa `withRetry` (T06) e converte falhas em `CompletionError` (T04).
- [ ] Timeout configurável; estouro vira `UpstreamTimeoutError`.
- [ ] Teste unitário com cliente mockado cobre sucesso, retry e timeout.

**Dependências:** T02, T03, T04, T06
**Tamanho:** M

---

## T11 — Validação da saída do modelo + construção da resposta HTTP (`src/services/response-validator.ts`, `src/functions/query/response-builder.ts`)
**Descrição:** Validar/normalizar a saída do modelo (não vazia, dentro do esperado) e, em seguida, formatar
a `QueryResponse` final (answer + `source_document`) no contrato de saída esperado. Os dois passos formam
uma única etapa de "transformar o texto bruto do modelo em resposta validada e no contrato".

**Critérios de aceite:**
- [ ] `validateModelOutput(text): string` rejeita saída vazia/erro com `CompletionError` (T04).
- [ ] `buildResponse(answer, chunks): QueryResponse` inclui `sourceDocument` derivado dos chunks usados.
- [ ] Output final validado por schema Zod antes de retornar.
- [ ] Teste unitário cobre saída do modelo válida e inválida, e verifica a presença e o valor de `source_document`.

**Dependências:** T02, T04
**Tamanho:** P

---

## T12 — Orquestração do handler HTTP (`src/functions/query/handler.ts`)
**Descrição:** Substituir o stub `501` da T01 pelo fluxo completo: validar input → buscar chunks →
montar prompt → completar → validar output → construir resposta, com logging e tratamento de erros.

**Critérios de aceite:**
- [ ] Reutiliza o trigger e o `parseQueryRequest` registrados na T01 (sem reescrever o setup).
- [ ] Fluxo encadeia T08→T09→T10→T11 e retorna `200` com `{ answer, source_document }`.
- [ ] Erros mapeados via `toHttpError` (T04): 400 (validação), 502/504 (upstream).
- [ ] Cada request gera log estruturado com `requestId` (T05); nenhum `console.log`.
- [ ] Não restam `TODO`/`501`/`throw new Error("Not implemented")` no arquivo.

**Dependências:** T01, T05, T08, T09, T10, T11
**Tamanho:** G

---

## T13 — Teste de integração do endpoint
**Descrição:** Teste end-to-end do handler com os serviços Azure mockados, exercitando o caminho feliz e os de erro.

**Critérios de aceite:**
- [ ] Caminho feliz: pergunta válida → `200` com `answer` e `source_document` não vazios.
- [ ] Pergunta inválida → `400`; falha de search/completion → `502`/`504`.
- [ ] `npm run test` passa e a cobertura global mantém `lines ≥ 80` (vitest.config.ts).

**Dependências:** T12
**Tamanho:** M