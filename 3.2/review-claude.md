# Revisão de PR — `feedbackHandler`

Encontrei **6 problemas** (alguns se sobrepõem numa mesma linha). Ordenados por gravidade.

---

## 🔴 1. Log de dado pessoal (e-mail) — Problema de segurança + Violação do AGENTS.md

```ts
console.log('Feedback recebido:', JSON.stringify(feedback));
// feedback.attendantEmail está incluído no objeto serializado
```

**Por quê:** o objeto `feedback` contém `attendantEmail`, e ele é serializado inteiro para o log. Isso viola diretamente a regra *"Nunca registrar dados pessoais (nome, e-mail, etc.) em logs"*. E-mails em logs são PII — vazam para agregadores de log, ferramentas de observabilidade e retenção de longo prazo, criando exposição de LGPD.

**Como corrigir:** nunca logar o objeto completo. Logar apenas identificadores não-pessoais (`queryId`, `rating`) e, se necessário rastrear o atendente, usar um ID pseudonimizado — nunca o e-mail em texto claro.

---

## 🔴 2. `console.log` em vez de `pino` — Violação do AGENTS.md

```ts
console.log('Feedback recebido:', ...);
```

**Por quê:** a regra é explícita — *"Utilizar pino para logging (nunca console.log)"*. Além da conformidade, `console.log` não tem níveis, contexto estruturado nem redaction — justamente o que o pino oferece (e o `redact` do pino resolveria o problema #1 automaticamente).

**Como corrigir:** injetar/usar o logger pino do projeto (`logger.info(...)`), idealmente com `redact` configurado para campos sensíveis.

---

## 🔴 3. `require` dinâmico — Violação do AGENTS.md

```ts
const { CosmosClient } = require('@azure/cosmos');
```

**Por quê:** viola *"Utilizar apenas imports estáticos no topo do arquivo (nunca require dinâmico)"*. Em projeto `"type": "module"` (ESM), `require` nem é garantido; quebra tree-shaking, análise estática e tipagem. Também recria o client a cada invocação (ver #6).

**Como corrigir:** `import { CosmosClient } from '@azure/cosmos';` no topo do arquivo.

---

## 🔴 4. Input sem validação Zod + `as any` — Violação do AGENTS.md + Bug potencial

```ts
const body = await request.json() as any;
const feedback = { queryId: body.queryId, rating: body.rating, comment: body.comment, attendantEmail: body.attendantEmail, ... };
```

**Por quê:**
- Viola *"Utilizar Zod para validação de inputs"* — o corpo entra sem nenhuma validação.
- `as any` anula o modo strict do TypeScript: nenhum campo é verificado, erros de digitação passam silenciosos.
- **Bug:** `queryId`, `rating`, `comment` podem vir ausentes, com tipo errado (`rating` string em vez de número) ou com `comment` gigantesco — tudo é gravado no Cosmos sem crítica. Dados inconsistentes/lixo no banco.

**Como corrigir:** definir um `feedbackSchema` Zod (ex.: `queryId` string obrigatória, `rating` número em faixa, `comment` string opcional com `max`) e fazer `safeParse`, retornando **400** quando inválido — no mesmo padrão do [validator.ts](src/functions/query/validator.ts) já existente no projeto.

---

## 🟠 5. `request.json()` sem tratamento de erro — Bug potencial

```ts
const body = await request.json() as any;
```

**Por quê:** se o corpo não for JSON válido, `request.json()` lança exceção não tratada → 500 genérico para o cliente, sem mensagem útil. O [queryHandler](src/functions/query/handler.ts:18) já trata isso com `try/catch` retornando 400 — este handler diverge do padrão.

**Como corrigir:** envolver o parse em `try/catch` e retornar 400 (`"Corpo deve ser JSON válido"`), reaproveitando o mesmo formato de erro do handler existente.

---

## 🟠 6. `COSMOS_CONNECTION_STRING` sem checagem + client recriado por request — Bug potencial

```ts
const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
```

**Por quê:**
- Em strict mode, `process.env.X` é `string | undefined`. Passar `undefined` ao construtor é erro de tipo e, em runtime, falha obscura se a env var não estiver setada.
- O client (e a conexão) é instanciado **a cada invocação** — em Azure Functions o correto é criar uma vez em escopo de módulo e reaproveitar entre execuções (custo de conexão/handshake por request).

**Como corrigir:** validar a env var na inicialização (falhar cedo com mensagem clara) e instanciar `CosmosClient`/`container` uma única vez em escopo de módulo, fora do handler.

---

## Observações menores (fora das regras listadas, mas vale registrar)
- `app.http('feedback', ...)` não define `authLevel`; o [queryHandler](src/functions/query/handler.ts:44) define `authLevel: 'anonymous'` explicitamente. Vale alinhar a política de auth conscientemente, ainda mais num endpoint que grava dados.
- Persistir `attendantEmail` no Cosmos (além de logar) é uma decisão de tratamento de PII que merece confirmação — o problema de log é o que viola a regra, mas o armazenamento também deveria passar por avaliação de LGPD.

---

**Resumo:** 4 violações diretas do AGENTS.md (log de PII, `console.log`, `require` dinâmico, ausência de Zod), sendo o log de e-mail também um problema de segurança, mais 2 bugs potenciais (parse sem try/catch, env var/client). Recomendo **bloquear o merge** até correção — os itens #1, #3 e #4 são impeditivos. Quando quiser, aplico as correções.