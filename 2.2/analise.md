**1. Os testes não cobrem o handler (bloqueia o merge).** Hoje só testamos o `parseQueryRequest`. O AC pede para validar os status retornados, e nenhum teste exercita o handler de fato — os caminhos de 400 (JSON inválido e validação) e o 501 estão descobertos. Dá pra quebrar o retorno HTTP sem nenhum teste acusar. Precisa de um teste mockando o `HttpRequest` e conferindo `status`/`jsonBody`.

**2. Corpo não-objeto cai em mensagem de erro em inglês.** As mensagens em PT só aparecem quando `question` existe. Se o body for `null`, número ou string solta, o Zod devolve o texto padrão dele ("Expected object, received...") direto no 400. Fica misturando idioma e expondo erro técnico. Vale tratar o tipo no nível do objeto.

**3. O 501 devolve a pergunta do usuário (`received: { question }`).** Num stub isso não serve pra nada e é refletir input de volta sem necessidade. Tiraria.

**4. Erro inesperado some.** Como o handler não recebe o `InvocationContext`, qualquer erro fora do esperado vira um 500 sem log nem requestId. O logging estruturado é T05, mas manteria o `context` na assinatura agora pra não perder isso depois.

**5. Schema aceita campos extras.** `{ question, ...qualquer coisa }` passa e os campos sobrando são descartados em silêncio. Se for pra recusar, falta um `.strict()`.

Pontos menores, mais pra discussão: 501 é tecnicamente pra método não suportado (503 seria mais correto pro placeholder); o `app.http()` roda no import, então registro e lógica ficam acoplados; e o corpo usa `"ValidationError"` enquanto a classe é `InputValidationError`.