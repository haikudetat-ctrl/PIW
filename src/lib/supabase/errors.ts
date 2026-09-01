import type { PostgrestError } from "@supabase/supabase-js";

/**
 * The diagnostic fields PostgREST returns alongside a failed request.
 *
 * Declared structurally rather than as `PostgrestError` so RPC results, view
 * reads and embedded selects all satisfy it without casting.
 */
export type SupabaseErrorLike = Partial<
  Pick<PostgrestError, "message" | "code" | "details" | "hint">
>;

const NO_ROW_FALLBACK = "query succeeded but returned no matching row";

/**
 * Render a Supabase failure as a diagnosable single-line message.
 *
 * Supabase reports the Postgres code, message, details and hint on `error`.
 * Throwing a bare `new Error("Failed to X")` discards all four, which is why
 * production logs could say an estimate failed without ever saying why.
 */
export function describeSupabaseError(
  context: string,
  error: SupabaseErrorLike | null | undefined,
  fallback: string = NO_ROW_FALLBACK,
): string {
  if (!error) return `${context}: ${fallback}`;

  const parts = [
    error.code ? `code=${error.code}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? `${context}: ${parts.join("; ")}` : context;
}

/**
 * Build the Error to throw at a failed Supabase call site.
 *
 * Pass the `error` even when the call failed only because no row came back —
 * a null error produces the `fallback` wording, which distinguishes "the query
 * was rejected" from "the query ran and matched nothing".
 */
export function supabaseError(
  context: string,
  error: SupabaseErrorLike | null | undefined,
  fallback: string = NO_ROW_FALLBACK,
): Error {
  return new Error(describeSupabaseError(context, error, fallback));
}
