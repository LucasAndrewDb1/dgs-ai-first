import { z } from "zod";

export const ResponseSchema = z
  .object({
    answer: z
      .string({
        required_error: "answer é obrigatório.",
        invalid_type_error: "answer deve ser uma string.",
      })
      .min(1, "answer não pode ser vazio."),
    source_document: z
      .string({
        required_error: "source_document é obrigatório.",
        invalid_type_error: "source_document deve ser uma string.",
      })
      .min(1, "source_document não pode ser vazio."),
    confidence_score: z
      .number({
        required_error: "confidence_score é obrigatório.",
        invalid_type_error: "confidence_score deve ser um número.",
      })
      .min(0, "confidence_score deve ser no mínimo 0.")
      .max(1, "confidence_score deve ser no máximo 1."),
  })
  .strict();

export type Response = z.infer<typeof ResponseSchema>;

export const SAFE_RESPONSE: Response = {
  answer:
    "Não foi possível validar esta resposta com segurança. " +
    "Consulte a documentação oficial da NovaTech ou o suporte antes de prosseguir.",
  source_document: "N/A",
  confidence_score: 0,
};

function logRejection(reason: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(`[response-validator] resposta rejeitada: ${reason}`);
  } else {
    console.warn(`[response-validator] resposta rejeitada: ${reason}`, details);
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const DANGEROUS_CARGO_TERM = "carga perigosa";
const RETURN_TERM = "devol";

const RETURN_ALLOWED_PATTERNS: readonly RegExp[] = [
  /pode[m]?(?:-se)?\s+(?:ser\s+)?devolvid[oa]s?/,
  /pode[m]?(?:-se)?\s+devolver/,
  /(?:e|esta)\s+possivel\s+devolver/,
  /devol\w*[^.!?]*?\b(?:permitid[ao]|autorizad[ao]|liberad[ao])\b/,
  /\b(?:permitid[ao]|autorizad[ao]|liberad[ao])\b[^.!?]*?devol\w*/,
];

const NEGATION_PATTERN = /\b(?:nao|nunca|jamais|proib\w*|vedad\w*)\b/;

function claimsDangerousReturnAllowed(answer: string): boolean {
  const text = normalize(answer);

  if (!text.includes(DANGEROUS_CARGO_TERM) || !text.includes(RETURN_TERM)) {
    return false;
  }

  return RETURN_ALLOWED_PATTERNS.some((pattern) => {
    const match = pattern.exec(text);
    if (!match) return false;
    const start = Math.max(0, match.index - 30);
    const window = text.slice(start, match.index + match[0].length);
    return !NEGATION_PATTERN.test(window);
  });
}

export function validateResponse(input: unknown): Response {
  const result = ResponseSchema.safeParse(input);
  if (!result.success) {
    logRejection(
      "falha de schema",
      result.error.issues.map((issue) => issue.message),
    );
    return SAFE_RESPONSE;
  }

  const response = result.data;

  if (response.source_document.trim().length === 0) {
    logRejection("source_document ausente");
    return SAFE_RESPONSE;
  }

  if (claimsDangerousReturnAllowed(response.answer)) {
    logRejection(
      "afirma que a devolução de carga perigosa é permitida",
      response.answer,
    );
    return SAFE_RESPONSE;
  }

  return response;
}