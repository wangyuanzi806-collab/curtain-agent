type MfaFactor = {
  id: string;
  factor_type: string;
  status: string;
};

type MfaOperationError = {
  code?: string;
  message?: string;
};

type TotpEnrollment = {
  id: string;
  totp: {
    qr_code: string;
    secret: string;
  };
};

type MfaEnrollmentClient = {
  listFactors: () => Promise<{
    data: { all: MfaFactor[] } | null;
    error: MfaOperationError | null;
  }>;
  unenroll: (input: { factorId: string }) => Promise<{
    data: unknown;
    error: MfaOperationError | null;
  }>;
  enroll: () => Promise<{
    data: unknown;
    error: MfaOperationError | null;
  }>;
};

function operationError(error: MfaOperationError | null, fallback: string) {
  const next = new Error(error?.message || fallback) as Error & { code?: string };
  if (error?.code) next.code = error.code;
  return next;
}

function isTotpEnrollment(value: unknown): value is TotpEnrollment {
  if (!value || typeof value !== "object") return false;
  const enrollment = value as Partial<TotpEnrollment>;
  return Boolean(
    enrollment.id
      && enrollment.totp?.qr_code
      && enrollment.totp.secret
  );
}

async function removeStaleTotpFactors(client: MfaEnrollmentClient) {
  const factors = await client.listFactors();
  if (factors.error || !factors.data) {
    throw operationError(factors.error, "读取双重验证状态失败。");
  }

  const staleFactors = factors.data.all.filter(
    (factor) => factor.factor_type === "totp" && factor.status !== "verified"
  );
  for (const factor of staleFactors) {
    const result = await client.unenroll({ factorId: factor.id });
    if (result.error) throw operationError(result.error, "清理未完成的验证器绑定失败。");
  }
}

async function enrollTotp(client: MfaEnrollmentClient) {
  const result = await client.enroll();
  if (result.error) throw operationError(result.error, "开始绑定验证器失败。");
  if (!isTotpEnrollment(result.data)) throw new Error("验证器绑定响应格式不正确。");
  return result.data;
}

export async function prepareTotpEnrollment(client: MfaEnrollmentClient) {
  await removeStaleTotpFactors(client);
  try {
    return await enrollTotp(client);
  } catch (error) {
    if (!(error instanceof Error) || (error as Error & { code?: string }).code !== "mfa_factor_name_conflict") {
      throw error;
    }
  }

  // A second tab can create an unverified factor between cleanup and enrollment.
  // Resolve that single race once; repeated failures are surfaced to the user.
  await removeStaleTotpFactors(client);
  return enrollTotp(client);
}
