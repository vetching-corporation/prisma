import {
  arg,
  canPrompt,
  checkUnsupportedDataProxy,
  Command,
  dropDatabase,
  format,
  HelpError,
  isError,
  link,
  loadEnvFile,
  loadSchemaContext,
} from '@prisma/internals'
import type { PrismaConfigInternal } from '@vetching-corporation/prisma-config'
import { bold, dim, red, yellow } from 'kleur/colors'
import prompt from 'prompts'

import { parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { DbDropNeedsForceError } from '../utils/errors'
import { PreviewFlagError } from '../utils/flagErrors'
import { printDatasource } from '../utils/printDatasource'

export class DbDrop implements Command {
  public static new(): DbDrop {
    return new DbDrop()
  }

  private static help = format(`
${process.platform === 'win32' ? '' : '💣  '}Drop the database

${bold(yellow('WARNING'))} ${bold(
    `Prisma db drop is currently in Preview (${link('https://pris.ly/d/preview')}).
There may be bugs and it's not recommended to use it in production environments.`,
  )}
${dim('When using any of the subcommands below you need to explicitly opt-in via the --preview-feature flag.')}

${bold('Usage')}

  ${dim('$')} prisma db drop [options] --preview-feature

${bold('Options')}

   -h, --help   Display this help message
     --config   Custom path to your Prisma config file
     --schema   Custom path to your Prisma schema
  -f, --force   Skip the confirmation prompt

${bold('Examples')}

  Drop the database
  ${dim('$')} prisma db drop --preview-feature

  Specify a schema
  ${dim('$')} prisma db drop --preview-feature --schema=./schema.prisma

  Use --force to skip the confirmation prompt
  ${dim('$')} prisma db drop --preview-feature --force
`)

  public async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--preview-feature': Boolean,
      '--force': Boolean,
      '-f': '--force',
      '--schema': String,
      '--config': String,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    if (!args['--preview-feature']) {
      throw new PreviewFlagError()
    }

    await loadEnvFile({ schemaPath: args['--schema'], printMessage: true, config })

    const schemaContext = await loadSchemaContext({
      schemaPathFromArg: args['--schema'],
      schemaPathFromConfig: config.schema,
    })

    checkUnsupportedDataProxy({ cmd: 'db drop', schemaContext })

    const datasourceInfo = parseDatasourceInfo(schemaContext.primaryDatasource)
    printDatasource({ datasourceInfo })

    process.stdout.write('\n') // empty line

    if (!args['--force']) {
      if (!canPrompt()) {
        throw new DbDropNeedsForceError('drop')
      }

      const confirmation = await prompt({
        type: 'text',
        name: 'value',
        message: `Enter the ${datasourceInfo.prettyProvider} database name "${
          datasourceInfo.dbName
        }" to drop it.\nLocation: "${datasourceInfo.dbLocation}".\n${red('All data will be lost')}.`,
      })
      process.stdout.write('\n') // empty line

      if (!confirmation.value) {
        process.stdout.write('Drop cancelled.\n')
        // Return SIGINT exit code to signal that the process was cancelled.
        process.exit(130)
      } else if (confirmation.value !== datasourceInfo.dbName) {
        throw Error(`The database name entered "${confirmation.value}" doesn't match "${datasourceInfo.dbName}".`)
      }
    }

    // Url exists because we set `ignoreEnvVarErrors: false` when calling `loadSchemaContext`
    if (await dropDatabase(datasourceInfo.url!, datasourceInfo.configDir!)) {
      return `${process.platform === 'win32' ? '' : '🚀  '}The ${datasourceInfo.prettyProvider} database "${
        datasourceInfo.dbName
      }" from "${datasourceInfo.dbLocation}" was successfully dropped.\n`
    } else {
      return ''
    }
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${DbDrop.help}`)
    }
    return DbDrop.help
  }
}
