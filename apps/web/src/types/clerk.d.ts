export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: unknown;
    };
  }
}
