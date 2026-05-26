export class RequestContext {
  constructor() {}
  public toTS(): string {
    return [
      'export type DynamicSchema = { from: string; to: string }',
      'export type RequestContextPayload = { dynamicSchemas?: DynamicSchema[]; forceWriter?: boolean; usePrimary?: boolean }',
      'export type RequestContext = AsyncLocalStorage<RequestContextPayload>',
    ].join('\n')
  }
}
