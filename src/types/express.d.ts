export {};

// Teaches TypeScript that authenticated requests carry `req.account`.
declare global {
  namespace Express {
    interface Request {
      account?: {
        id: string;
        name: string;
        planId: string;
      };
    }
  }
}