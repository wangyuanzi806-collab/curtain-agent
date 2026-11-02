export type AuthAssuranceLevel = "aal1" | "aal2" | null;

export function hasRequiredAdminMfa(input: {
  authAssuranceLevel: AuthAssuranceLevel;
  isDemo: boolean;
}) {
  return input.isDemo || input.authAssuranceLevel === "aal2";
}
