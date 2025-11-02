export class RequestContext {
  constructor() {}
  public toTS(): string {
    return [
      'export type RequestContext = {',
      '  init: <R>(cb: () => R, opts?: { schema?: string; usePrimary?: boolean }) => R',
      '}',
    ].join('\n')
  }
}
