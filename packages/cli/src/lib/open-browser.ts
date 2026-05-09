export async function openBrowser(url: string): Promise<void> {
  const mod = (await import('open')) as { default: (target: string) => Promise<unknown> };
  await mod.default(url);
}

export function shouldAutoOpen(env: NodeJS.ProcessEnv, isTty: boolean): boolean {
  if (env.CI === '1' || env.CI === 'true') return false;
  return isTty;
}
