import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

        // error with a status code and a message
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

  // catch errors from async routes
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

 // send errors in the same format
export const notFoundHandler: RequestHandler =  (req, _res, next) => {
  next(new HttpError(404, "not_found", `Route not found: ${req.method}  ${req.path}`));
};

   // the request body has invalid json
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details:  err.details } : {}),
      },
    });
    return;
     }

  // express.json() reports broken JSON with this type.
  if (err && (err as { type?:  string }).type === " entity.parse.failed") {
    res.status(400).json({
      error: { code: "invalid_json", message: "The request body is not valid JSON." },
    } );
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong on our side." },
  } );
};