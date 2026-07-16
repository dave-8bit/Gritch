export async function throwFetchHttpError(params: {
  response: Response;
  prefix: string;
}): Promise<never> {
  const { response, prefix } = params;

  const text = await response.text().catch(() => '');
  throw new Error(
    `${prefix}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
  );
}

