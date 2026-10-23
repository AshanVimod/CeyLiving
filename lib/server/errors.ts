import "server-only";

export type ErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "RATE_LIMITED" | "UNAVAILABLE";

/** Errors the services throw on purpose; their messages are safe to show to the person. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Sign in to continue.") {
    super("UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You can’t do that.") {
    super("FORBIDDEN", message);
  }
}

/** Also used for other people's private data, so existence isn't leaked (SEC-A5). */
export class NotFoundError extends DomainError {
  constructor(message = "We couldn’t find that.") {
    super("NOT_FOUND", message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super("VALIDATION", message, fieldErrors);
  }
}

export class RateLimitError extends DomainError {
  constructor(message = "You’re doing that too often. Try again later.") {
    super("RATE_LIMITED", message);
  }
}

export class StoreUnavailableError extends DomainError {
  constructor() {
    super("UNAVAILABLE", "This feature isn’t available yet.");
  }
}
