// HTTP trigger do query endpoint (T01).
// Setup do endpoint POST /api/query + validação de input.
// O pipeline real (busca, prompt, completion) é a T12 — aqui retornamos 501.
// Padrões (ver AGENTS.md): Azure Functions v4, Zod, sem console.log.

import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { InputValidationError, parseQueryRequest } from "./validator.js";

function badRequest(issues: string[]): HttpResponseInit {
  return {
    status: 400,
    jsonBody: { error: "ValidationError", issues },
  };
}

export async function queryHandler(request: HttpRequest): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(["Corpo da requisição deve ser um JSON válido."]);
  }

  try {
    const { question } = parseQueryRequest(body);
    return {
      status: 501,
      jsonBody: {
        error: "NotImplemented",
        message: "Pipeline de query ainda não implementado (ver T12).",
        received: { question },
      },
    };
  } catch (err) {
    if (err instanceof InputValidationError) {
      return badRequest(err.issues);
    }
    throw err;
  }
}

app.http("query", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "query",
  handler: queryHandler,
});
