// Validação de input do endpoint POST /api/query (T01).
// O schema Zod é a fonte da verdade do contrato de entrada; o tipo `QueryRequest`
// é inferido aqui e será consolidado em src/shared/types.ts (T02).

import { z } from "zod";

export const MAX_QUESTION_LENGTH = 1000;

export const queryRequestSchema = z.object({
  question: z
    .string({
      required_error: "question é obrigatório.",
      invalid_type_error: "question deve ser uma string.",
    })
    .trim()
    .min(1, "question não pode ser vazio.")
    .max(MAX_QUESTION_LENGTH, `question deve ter no máximo ${MAX_QUESTION_LENGTH} caracteres.`),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;

/**
 * Erro de validação de input. Carrega apenas mensagens legíveis (sem stack)
 * para que o handler possa montar um 400 sem vazar detalhes internos.
 * Generalizado depois pela taxonomia de erros (T04).
 */
export class InputValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super("Input de query inválido.");
    this.name = "InputValidationError";
    this.issues = issues;
  }
}

/**
 * Faz o parse seguro do corpo da requisição.
 * @throws {InputValidationError} quando o corpo não satisfaz o schema.
 */
export function parseQueryRequest(body: unknown): QueryRequest {
  const result = queryRequestSchema.safeParse(body);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message);
    throw new InputValidationError(issues);
  }

  return result.data;
}
