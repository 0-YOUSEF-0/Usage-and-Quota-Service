import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/errors";
import { parseWith } from "../http/validate";
import { authenticate } from "../middleware/authenticate";
import { consume } from "../services/consume";

export const consumeRouter = Router();

const consumeSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  units: z.number().int().min(1).max(1_000_000_000_000),
  requestId: z.string().trim().min(1).max(200),
});

// Both accepted and rejected decisions are HTTP 200: the call itself worked.
// Read "accepted" in the body. Bad input is 400, bad key 401, unknown user 404.
consumeRouter.post(
  "/consume",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = parseWith(consumeSchema, req.body);
    const decision = await consume({ accountId: req.account!.id, ...body });
    res.status(200).json(decision);
  })
);