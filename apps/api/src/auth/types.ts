/**
 * Identity carried by a verified access token. Deliberately minimal —
 * request handlers should use this instead of loading the full database
 * `User` record on every call.
 */
export interface AuthenticatedUser {
  sub: string; // userId
  email: string;
  sid: string; // the UserSession id this access token was issued from
}
