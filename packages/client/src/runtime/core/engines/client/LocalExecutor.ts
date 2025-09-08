import {
  type QueryEvent,
  QueryInterpreter,
  type SchemaProvider,
  type TracingHelper,
  TransactionManager,
  type TransactionOptions,
} from '@prisma/client-engine-runtime'
import type { ConnectionInfo, SqlDriverAdapter, SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'

import type { InteractiveTransactionInfo } from '../common/types/Transaction'
import type { ExecutePlanParams, Executor, ProviderAndConnectionInfo } from './Executor'

const readOperations = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
  'aggregate',
  'count',
  'findRaw',
  'aggregateRaw',
]

export interface LocalExecutorOptions {
  driverAdapterFactory: SqlDriverAdapterFactory
  driverAdapterReplicaFactory?: SqlDriverAdapterFactory
  transactionOptions: TransactionOptions
  tracingHelper: TracingHelper
  onQuery?: (event: QueryEvent) => void
  provider?: SchemaProvider
}

export class LocalExecutor implements Executor {
  readonly #options: LocalExecutorOptions
  readonly #driverAdapter: SqlDriverAdapter
  readonly #driverAdapterReplica?: SqlDriverAdapter
  readonly #transactionManager: TransactionManager
  readonly #connectionInfo?: ConnectionInfo

  constructor(
    options: LocalExecutorOptions,
    driverAdapter: SqlDriverAdapter,
    driverAdapterReplica: SqlDriverAdapter | undefined,
    transactionManager: TransactionManager,
  ) {
    this.#options = options
    this.#driverAdapter = driverAdapter
    this.#driverAdapterReplica = driverAdapterReplica
    this.#transactionManager = transactionManager
    this.#connectionInfo = driverAdapter.getConnectionInfo?.()
  }

  static async connect(options: LocalExecutorOptions): Promise<LocalExecutor> {
    let driverAdapter: SqlDriverAdapter | undefined = undefined
    let driverAdapterReplica: SqlDriverAdapter | undefined = undefined
    let transactionManager: TransactionManager | undefined = undefined

    try {
      driverAdapter = await options.driverAdapterFactory.connect()
      driverAdapterReplica = await options.driverAdapterReplicaFactory?.connect()
      transactionManager = new TransactionManager({
        driverAdapter,
        transactionOptions: options.transactionOptions,
        tracingHelper: options.tracingHelper,
        onQuery: options.onQuery,
        provider: options.provider,
      })
    } catch (error) {
      await driverAdapter?.dispose()
      await driverAdapterReplica?.dispose()
      throw error
    }

    return new LocalExecutor(options, driverAdapter, driverAdapterReplica, transactionManager)
  }

  getConnectionInfo(): Promise<ProviderAndConnectionInfo> {
    const connectionInfo = this.#connectionInfo ?? { supportsRelationJoins: false }
    return Promise.resolve({ provider: this.#driverAdapter.provider, connectionInfo })
  }

  async execute({ plan, placeholderValues, transaction, batchIndex, operation }: ExecutePlanParams): Promise<unknown> {
    const queryable = transaction
      ? await this.#transactionManager.getTransaction(transaction, batchIndex !== undefined ? 'batch query' : 'query')
      : this.#driverAdapterReplica !== undefined && readOperations.includes(operation)
        ? this.#driverAdapterReplica
        : this.#driverAdapter

    const interpreter = QueryInterpreter.forSql({
      transactionManager: transaction ? { enabled: false } : { enabled: true, manager: this.#transactionManager },
      placeholderValues,
      onQuery: this.#options.onQuery,
      tracingHelper: this.#options.tracingHelper,
      provider: this.#options.provider,
      connectionInfo: this.#connectionInfo,
    })

    return await interpreter.run(plan, queryable)
  }

  async startTransaction(options: TransactionOptions): Promise<InteractiveTransactionInfo> {
    return { ...(await this.#transactionManager.startTransaction(options)), payload: undefined }
  }

  async commitTransaction(transaction: InteractiveTransactionInfo): Promise<void> {
    await this.#transactionManager.commitTransaction(transaction.id)
  }

  async rollbackTransaction(transaction: InteractiveTransactionInfo): Promise<void> {
    await this.#transactionManager.rollbackTransaction(transaction.id)
  }

  async disconnect(): Promise<void> {
    try {
      await this.#transactionManager.cancelAllTransactions()
    } finally {
      await this.#driverAdapter.dispose()
      await this.#driverAdapterReplica?.dispose()
    }
  }

  apiKey(): string | null {
    return null
  }
}
