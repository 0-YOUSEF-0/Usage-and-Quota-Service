import type { NextFunction, Request, Response } from "express";
import { hashApiKey, looksLikeApiKey } from "../auth/apiKey";
import { pool } from "../database/pool";
import { HttpError, asyncHandler } from "../http/errors";

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // get the api key from the request
    const key = req.get("x-api-key");

              // check if the key was sent
    if (!key) {
      throw new HttpError(
        401,
        "missing_api_key",
        "Missing API key. Send it in the X-API-Key header."
      );
    }
    // check if the key has the right format
    if (!looksLikeApiKey(key)) {
      throw new HttpError(401, "invalid_api_key", "The API key is not valid.");
    }

                 // find the account using the key hash
    const { rows } = await pool.query<{ id: string; name: string; plan_id: string }>(
      "SELECT id, name, plan_id FROM accounts WHERE api_key_hash = $1",
      [hashApiKey(key)]
    );

              // key doesnt match any account
    if (rows.length === 0) {
      throw new HttpError(401, "invalid_api_key", "The API key is not valid.");
    }

         // key doesnt match any account
    req.account = {
      id: rows[0].id,
      name: rows[0].name,
      planId: rows[0].plan_id,
    };
    next();
  }
);