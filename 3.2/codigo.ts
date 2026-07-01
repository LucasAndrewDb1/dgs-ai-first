import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { z } from "zod";
import pino from "pino";

const logger = pino({
  redact: {
    paths: ["attendantEmail", "*.attendantEmail", "comment", "*.comment"],
    censor: "[REDACTED]",
  },
});

const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
if (!COSMOS_CONNECTION_STRING) {
  throw new Error("COSMOS_CONNECTION_STRING não está configurada.");
}

const cosmosClient = new CosmosClient(COSMOS_CONNECTION_STRING);
const feedbackContainer = cosmosClient
  .database("novatech")
  .container("feedbacks");

const MAX_COMMENT_LENGTH = 2000;

const feedbackSchema = z
  .object({
    queryId: z
      .string({
        required_error: "queryId é obrigatório.",
        invalid_type_error: "queryId deve ser uma string.",
      })
      .uuid("queryId deve ser um UUID válido."),
    rating: z
      .number({
        required_error: "rating é obrigatório.",
        invalid_type_error: "rating deve ser um número.",
      })
      .int("rating deve ser inteiro.")
      .min(1, "rating deve ser no mínimo 1.")
      .max(5, "rating deve ser no máximo 5."),
    comment: z
      .string()
      .trim()
      .max(MAX_COMMENT_LENGTH, `comment deve ter no máximo ${MAX_COMMENT_LENGTH} caracteres.`)
      .optional(),
    attendantEmail: z
      .string({
        required_error: "attendantEmail é obrigatório.",
        invalid_type_error: "attendantEmail deve ser uma string.",
      })
      .email("attendantEmail deve ser um e-mail válido."),
  })
  .strict();

type FeedbackInput = z.infer<typeof feedbackSchema>;

function jsonError(status: number, error: string, issues?: string[]): HttpResponseInit {
  return { status, jsonBody: { error, ...(issues ? { issues } : {}) } };
}

export async function feedbackHandler(request: HttpRequest): Promise<HttpResponseInit> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "ValidationError", ["Corpo da requisição deve ser um JSON válido."]);
  }

  const parsed = feedbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      400,
      "ValidationError",
      parsed.error.issues.map((issue) => issue.message),
    );
  }
  const input: FeedbackInput = parsed.data;

  const feedback = {
    ...input,
    timestamp: new Date().toISOString(),
  };

  try {
    await feedbackContainer.items.create(feedback);
  } catch (err) {
    logger.error({ queryId: input.queryId, err }, "Falha ao persistir feedback.");
    return jsonError(500, "InternalError", ["Não foi possível registrar o feedback."]);
  }

  logger.info({ queryId: input.queryId, rating: input.rating }, "Feedback registrado.");
  return { status: 201, jsonBody: { status: "created" } };
}

app.http("feedback", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "feedback",
  handler: feedbackHandler,
});