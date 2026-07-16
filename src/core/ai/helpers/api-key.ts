export function requireApiKey(key: string | undefined, envVarName: string): string {
  const value = key ?? '';
  if (!value) {
    // Preserve exact error messages across providers.
    throw new Error(`Missing ${envVarName}`);
  }
  return value;
}

