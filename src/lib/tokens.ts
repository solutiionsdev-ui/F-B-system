import { createHash, randomBytes } from "node:crypto";

/** A random, URL-safe secret for session cookies and invite links. */
export const newToken = () => randomBytes(32).toString("base64url");

/** What gets stored instead of the token, so a database leak doesn't hand out working links. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
