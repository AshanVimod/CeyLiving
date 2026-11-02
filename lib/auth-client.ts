"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

// B05b (AU-02): the one place the browser talks to Better Auth directly, for passkeys. WebAuthn needs the browser
// (the device signs a challenge from the server); the server still checks every answer. Everything else goes
// through server actions.
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
