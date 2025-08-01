import {
  arg,
  checkUnsupportedDataProxy,
  Command,
  format,
  getCommandWithExecutor,
  HelpError,
  inferDirectoryConfig,
  isError,
  link,
  loadEnvFile,
  loadSchemaContext,
} from '@prisma/internals'
import type { PrismaConfigInternal } from '@vetching-corporation/prisma-config'
import { bold, dim, green, red } from 'kleur/colors'

import { Migrate } from '../Migrate'
import { ensureCanConnectToDatabase, parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { printDatasource } from '../utils/printDatasource'

export class MigrateResolve implements Command {
  public static new(): MigrateResolve {
    return new MigrateResolve()
  }

  private static help = format(`
Resolve issues with database migrations in deployment databases: 
- recover from failed migrations
- baseline databases when starting to use Prisma Migrate on existing databases
- reconcile hotfixes done manually on databases with your migration history

Run "prisma migrate status" to identify if you need to use resolve.

Read more about resolving migration history issues: ${link('https://pris.ly/d/migrate-resolve')}
 
${bold('Usage')}

  ${dim('$')} prisma migrate resolve [options]
  
${bold('Options')}

    -h, --help   Display this help message
      --config   Custom path to your Prisma config file
      --schema   Custom path to your Prisma schema
     --applied   Record a specific migration as applied
 --rolled-back   Record a specific migration as rolled back

${bold('Examples')}

  Update migrations table, recording a specific migration as applied 
  ${dim('$')} prisma migrate resolve --applied 20201231000000_add_users_table

  Update migrations table, recording a specific migration as rolled back
  ${dim('$')} prisma migrate resolve --rolled-back 20201231000000_add_users_table

  Specify a schema
  ${dim('$')} prisma migrate resolve --rolled-back 20201231000000_add_users_table --schema=./schema.prisma
`)

  public async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--applied': String,
        '--rolled-back': String,
        '--schema': String,
        '--config': String,
        '--telemetry-information': String,
      },
      false,
    )

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    await loadEnvFile({ schemaPath: args['--schema'], printMessage: true, config })

    const schemaContext = await loadSchemaContext({
      schemaPathFromArg: args['--schema'],
      schemaPathFromConfig: config.schema,
    })
    const { migrationsDirPath } = inferDirectoryConfig(schemaContext, config)
    const adapter = await config.adapter?.()

    checkUnsupportedDataProxy({ cmd: 'migrate resolve', schemaContext })

    printDatasource({ datasourceInfo: parseDatasourceInfo(schemaContext.primaryDatasource), adapter })

    // if both are not defined
    if (!args['--applied'] && !args['--rolled-back']) {
      throw new Error(
        `--applied or --rolled-back must be part of the command like:
${bold(green(getCommandWithExecutor('prisma migrate resolve --applied 20201231000000_example')))}
${bold(green(getCommandWithExecutor('prisma migrate resolve --rolled-back 20201231000000_example')))}`,
      )
    }
    // if both are defined
    else if (args['--applied'] && args['--rolled-back']) {
      throw new Error('Pass either --applied or --rolled-back, not both.')
    }

    if (args['--applied']) {
      if (typeof args['--applied'] !== 'string' || args['--applied'].length === 0) {
        throw new Error(
          `--applied value must be a string like ${bold(
            green(getCommandWithExecutor('prisma migrate resolve --applied 20201231000000_example')),
          )}`,
        )
      }

      // `ensureCanConnectToDatabase` is not compatible with WebAssembly.
      // TODO: check why the output and error handling here is different than in `MigrateDeploy`.
      if (!adapter) {
        await ensureCanConnectToDatabase(schemaContext.primaryDatasource)
      }

      const migrate = await Migrate.setup({ adapter, migrationsDirPath, schemaContext })

      try {
        await migrate.markMigrationApplied({
          migrationId: args['--applied'],
        })
      } finally {
        await migrate.stop()
      }

      process.stdout.write(`\nMigration ${args['--applied']} marked as applied.\n`)
      return ``
    } else {
      if (typeof args['--rolled-back'] !== 'string' || args['--rolled-back'].length === 0) {
        throw new Error(
          `--rolled-back value must be a string like ${bold(
            green(getCommandWithExecutor('prisma migrate resolve --rolled-back 20201231000000_example')),
          )}`,
        )
      }

      await ensureCanConnectToDatabase(schemaContext.primaryDatasource)

      const migrate = await Migrate.setup({ adapter: undefined, migrationsDirPath, schemaContext })

      try {
        await migrate.markMigrationRolledBack({
          migrationId: args['--rolled-back'],
        })
      } finally {
        await migrate.stop()
      }

      process.stdout.write(`\nMigration ${args['--rolled-back']} marked as rolled back.\n`)
      return ``
    }
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${MigrateResolve.help}`)
    }
    return MigrateResolve.help
  }
}
