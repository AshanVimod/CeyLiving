import "server-only";
import { getAuth } from "./better-auth";

export type PasswordCheck = "correct" | "wrong" | "none";

/**
 * B11: checks the password of an account that is already signed in, for an action that asks for it again. Uses Better
 * Auth's own hashing. "none" means the account has no password (demo accounts, accounts from before B05a).
 */
export async function checkOwnPassword(userId: string, password: string): Promise<PasswordCheck> {
  const context = await getAuth().$context;
  const accounts = await context.internalAdapter.findAccounts(userId);
  const hash = accounts.find((account) => account.providerId === "credential")?.password;
  if (!hash) return "none";
  return (await context.password.verify({ hash, password })) ? "correct" : "wrong";
}
