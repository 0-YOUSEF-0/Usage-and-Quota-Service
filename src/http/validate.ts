import { z } from "zod";
import { HttpError } from "./errors";
export const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Must be a UUID"
  );

// Checks data against a schema, or throws a 400 listing every problem.
export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});

  if (!result.success) {
    throw new HttpError(
      400,
      "validation_error",
      "The request is not valid.",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }
  

  return result.data as z.infer<T>;
}