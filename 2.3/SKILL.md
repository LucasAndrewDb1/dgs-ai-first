---
name: backend-conventions
description: Foundation NovaTech — convenções obrigatórias de backend TypeScript. Aplicar SEMPRE ao escrever, revisar ou gerar qualquer código back-end NovaTech (Azure Functions, serviços, integrações Azure OpenAI/AI Search). Herdada por todas as skills Domain e Artifact.
metadata:
  layer: foundation
  inherited-by: all domain and artifact skills
---

# Context

Stack oficial do back-end NovaTech. Toda skill Domain/Artifact assume estas tecnologias e versões:

| Camada | Tecnologia | Observação |
|--------|-----------|------------|
| Linguagem | **TypeScript** | `strict: true`, sem `any` |
| Runtime serverless | **Azure Functions v4** | Modelo de programação v4 (registro via `app.http(...)`), não v3 |
| Front-end | **React** | Consome os endpoints; contratos validados via Zod |
| LLM | **Azure OpenAI** | Chamadas sempre com retry + timeout |
| Busca vetorial | **Azure AI Search** | Recuperação do pipeline RAG |
| Validação | **Zod** | Único mecanismo de validação de entrada externa |
| Logging | **pino** | Logging estruturado JSON; nunca `console.*` |

Premissa central: **tudo que cruza a fronteira do processo (HTTP, fila, Azure SDK, env vars) é não-confiável até ser validado com Zod.**

---

# Prescriptive Rules

Regras obrigatórias. "Obrigatório" = bloqueia merge em code review.

1. **TypeScript strict.** `tsconfig.json` com `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. Sem exceções por arquivo.
2. **Proibido `any`.** Use `unknown` + narrowing, generics, ou um schema Zod. `as any` e `// @ts-ignore` são proibidos; em último caso use `// @ts-expect-error` com justificativa na mesma linha.
3. **Zod para toda entrada externa.** Body, query, headers, env vars, mensagens de fila e respostas de APIs externas passam por `schema.parse()`/`safeParse()` antes de qualquer uso. O tipo vem de `z.infer`, nunca de uma `interface` escrita à mão em paralelo.
4. **Logging estruturado com pino.** Um logger por processo. Logue objetos (`logger.info({ requestId, userId }, "msg")`), não strings concatenadas. Inclua sempre um identificador de correlação.
5. **Proibido `console.log`/`console.error`.** Sem exceção em código de produção. Lint deve falhar.
6. **Funções pequenas.** Uma responsabilidade por função; alvo ≤ ~30 linhas. Handler HTTP só orquestra — não contém regra de negócio.
7. **Injeção de dependência preferida.** Serviços recebem clientes (Azure OpenAI, AI Search, logger) por parâmetro/construtor. Proibido instanciar SDK client dentro da função de negócio — impede teste e mock.
8. **Retry em chamadas Azure.** Toda chamada a Azure OpenAI / AI Search / Storage usa retry com backoff exponential + jitter e timeout. A lógica de retry é **centralizada** (um helper), nunca copiada por endpoint.
9. **Erros não expõem stack trace.** A resposta HTTP devolve um shape estável `{ error: { code, message } }` sem stack, sem mensagem de exceção crua. O stack vai para o log (pino), não para o cliente.

---

# DO / DON'T

## Validação com Zod

✅ **DO** — schema é a fonte do tipo; valida na borda:

```typescript
import { z } from "zod";

const CreateChatRequest = z.object({
  question: z.string().min(1).max(2_000),
  conversationId: z.string().uuid().optional(),
  topK: z.number().int().min(1).max(20).default(5),
});

type CreateChatRequest = z.infer<typeof CreateChatRequest>;

function parseBody(raw: unknown): CreateChatRequest {
  return CreateChatRequest.parse(raw); // lança ZodError -> tratado no handler
}
```

❌ **DON'T** — validação manual + interface paralela que diverge do runtime:

```typescript
interface CreateChatRequest {
  question: string;
  topK?: number;
}

function parseBody(raw: any): CreateChatRequest {
  if (!raw.question) throw new Error("question required"); // frágil, incompleto
  return raw; // ninguém garante os tipos em runtime
}
```

## Logger pino

✅ **DO** — logger injetado, log estruturado com correlação:

```typescript
import pino from "pino";

export const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "*.apiKey"],
});

export async function handleSearch(
  input: SearchInput,
  deps: { logger: pino.Logger; search: SearchClient },
): Promise<SearchResult> {
  const log = deps.logger.child({ requestId: input.requestId });
  log.info({ topK: input.topK }, "search.start");
  const result = await deps.search.query(input);
  log.info({ hits: result.hits.length }, "search.done");
  return result;
}
```

❌ **DON'T** — `console.log`, sem contexto, sem redaction:

```typescript
console.log("searching for " + input.question); // string concatenada, vaza PII
const result = await new SearchClient().query(input); // client instanciado inline
console.log("done");
```

## Tratamento de erro

✅ **DO** — stack vai para o log; cliente recebe shape estável sem stack:

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ZodError } from "zod";

app.http("createChat", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const log = baseLogger.child({ invocationId: ctx.invocationId });
    try {
      const body = CreateChatRequest.parse(await req.json());
      const result = await chatService.run(body, { logger: log });
      return { status: 200, jsonBody: result };
    } catch (err) {
      if (err instanceof ZodError) {
        return { status: 400, jsonBody: { error: { code: "VALIDATION_ERROR", message: "Invalid request" } } };
      }
      log.error({ err }, "createChat.failed"); // stack completo no log
      return { status: 500, jsonBody: { error: { code: "INTERNAL_ERROR", message: "Unexpected error" } } };
    }
  },
});
```

❌ **DON'T** — vazar stack/mensagem crua ao cliente:

```typescript
} catch (err) {
  return { status: 500, jsonBody: { error: String(err), stack: (err as Error).stack } }; // vaza internals
}
```

## Retry centralizado em chamadas Azure

✅ **DO** — helper único, reutilizado:

```typescript
export async function withRetry<T>(
  op: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; logger: pino.Logger; label: string },
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt > retries || !isTransient(err)) throw err;
      const delay = opts.baseMs ?? 200;
      const backoff = delay * 2 ** (attempt - 1) + Math.floor(Math.random() * delay); // jitter
      opts.logger.warn({ err, attempt, label: opts.label }, "azure.retry");
      await sleep(backoff);
    }
  }
}

// uso
const completion = await withRetry(
  () => openai.getChatCompletions(deployment, messages),
  { logger: log, label: "openai.chat" },
);
```

❌ **DON'T** — retry copiado e divergente em cada endpoint:

```typescript
let r;
for (let i = 0; i < 3; i++) {
  try { r = await openai.getChatCompletions(d, m); break; } catch (e) {} // sem backoff, sem jitter, engole erro
}
```

---

# Anti-patterns

Erros que LLMs/Copilot geram com frequência. **Todos devem ser rejeitados em review.**

### 1. Uso de `any`
```typescript
function handle(req: any) { return req.body.question; } // ❌
// → use unknown + Zod parse
```

### 2. `console.log` em produção
```typescript
console.log("user:", userId); // ❌ não estruturado, sem redaction
// → logger.info({ userId }, "...")
```

### 3. Catch vazio (swallow)
```typescript
try { await search.query(q); } catch (e) {} // ❌ erro some, sintoma vira bug fantasma
// → logue e propague, ou trate explicitamente
```

### 4. Validação manual em vez de Zod
```typescript
if (typeof body.question !== "string" || body.question.length === 0) { /* ... */ } // ❌
// → CreateChatRequest.parse(body)
```

### 5. Regra de negócio dentro do handler HTTP
```typescript
app.http("chat", { handler: async (req) => {
  // ❌ embeddings, busca, prompt assembly e chamada ao LLM tudo aqui dentro
  const emb = await openai.getEmbeddings(...);
  const hits = await search.query(...);
  const prompt = `...${hits}...`;
  // ...
}});
// → handler só valida + delega para chatService.run(body, deps)
```

### 6. Lógica de retry duplicada
```typescript
// ❌ cada arquivo reimplementa seu próprio loop de retry com regras diferentes
// → sempre withRetry(...) do helper compartilhado
```

### 7. Instanciar SDK client dentro da função de negócio
```typescript
function run(input: Input) {
  const openai = new OpenAIClient(endpoint, cred); // ❌ não testável, sem mock
}
// → receber `deps: { openai }` por injeção
```

### 8. Tipo escrito à mão em paralelo ao schema Zod
```typescript
interface Req { question: string; }     // ❌ diverge do schema com o tempo
const Schema = z.object({ question: z.string() });
// → type Req = z.infer<typeof Schema>
```
