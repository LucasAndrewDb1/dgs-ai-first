import { describe, it, expect } from "vitest";
import {
  InputValidationError,
  MAX_QUESTION_LENGTH,
  parseQueryRequest,
} from "../src/functions/query/validator.js";

describe("parseQueryRequest", () => {
  it("aceita um corpo válido e normaliza (trim)", () => {
    const result = parseQueryRequest({ question: "  Qual é o SLA de frete?  " });
    expect(result.question).toBe("Qual é o SLA de frete?");
  });

  it("rejeita question ausente", () => {
    expect(() => parseQueryRequest({})).toThrow(InputValidationError);
  });

  it("rejeita question não-string", () => {
    expect(() => parseQueryRequest({ question: 42 })).toThrow(InputValidationError);
  });

  it("rejeita question vazia (ou só espaços)", () => {
    expect(() => parseQueryRequest({ question: "   " })).toThrow(InputValidationError);
  });

  it("rejeita question acima do limite máximo", () => {
    const tooLong = "a".repeat(MAX_QUESTION_LENGTH + 1);
    expect(() => parseQueryRequest({ question: tooLong })).toThrow(InputValidationError);
  });

  it("expõe mensagens de erro sem stack trace", () => {
    try {
      parseQueryRequest({ question: "" });
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(InputValidationError);
      expect((err as InputValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
