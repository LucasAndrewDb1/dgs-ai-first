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
