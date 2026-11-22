/** Turn Postgres/PostgREST errors into messages a CRM user can act on. */
export function friendlyDbError(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  switch (error.code) {
    case "42501":
      // Raised by the demo-account guards; the text is written for end users.
      if (error.message?.startsWith("The demo account")) return error.message;
      return "You don't have permission to do that. Ask an admin if you need access.";
    case "23505":
      return "That record already exists.";
    case "23514":
      return "Some values are outside the allowed range. Check the form and try again.";
    case "23503":
      return "A linked record no longer exists. Refresh the page and try again.";
    case "PGRST116":
      return "We couldn't find that record. It may have been deleted or reassigned.";
    default:
      return fallback;
  }
}
