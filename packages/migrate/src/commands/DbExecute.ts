import streamConsumer from 'node:stream/consumers'

import {
  arg,
  checkUnsupportedDataProxy,
  checkUnsupportedSchemaEngineWasm,
  Command,
  format,
  getCommandWithExecutor,
  HelpError,
  isError,
  loadEnvFile,
  loadSchemaContext,
  toSchemasContainer,
} from '@prisma/internals'
import type { PrismaConfigInternal } from '@vetching-corporation/prisma-config'
import fs from 'fs'
import { bold, dim, green, italic } from 'kleur/colors'
import path from 'path'

import { Migrate } from '../Migrate'
import type { EngineArgs } from '../types'

const helpOptions = format(
  `${bold('Usage')}

${dim('$')} prisma db execute [options]

${bold('Options')}

-h, --help            Display this help message
--config              Custom path to your Prisma config file

${italic('Datasource input, only 1 must be provided:')}
--url                 URL of the datasource to run the command on
--schema              Path to your Prisma schema file to take the datasource URL from

${italic('Script input, only 1 must be provided:')}
--file                Path to a file. The content will be sent as the script to be executed

${bold('Flags')}

--stdin              Use the terminal standard input as the script to be executed`,
)

export class DbExecute implements Command {
  public static new(): DbExecute {
    return new DbExecute()
  }

  // TODO: This command needs to get proper support for `prisma.config.ts` eventually. Not just taking the schema path
  //  from prisma.config.ts but likely to support driver adapters, too?
  //  See https://linear.app/prisma-company/issue/ORM-639/prisma-db-execute-support-prismaconfigts-and-driver-adapters
  private static help = format(`
${process.platform === 'win32' ? '' : '📝 '}Execute native commands to your database

This command takes as input a datasource, using ${green(`--url`)} or ${green(`--schema`)} and a script, using ${green(
    `--stdin`,
  )} or ${green(`--file`)}.
The input parameters are mutually exclusive, only 1 of each (datasource & script) must be provided.
 
The output of the command is connector-specific, and is not meant for returning data, but only to report success or failure.

On SQL databases, this command takes as input a SQL script.
The whole script will be sent as a single command to the database.

${italic(`This command is currently not supported on MongoDB.`)}

${helpOptions}
${bold('Examples')}
 
  Execute the content of a SQL script file to the datasource URL taken from the schema
  ${dim('$')} prisma db execute
    --file ./script.sql \\
    --schema schema.prisma

  Execute the SQL script from stdin to the datasource URL specified via the \`DATABASE_URL\` environment variable
  ${dim('$')} echo 'TRUNCATE TABLE dev;' | \\
    prisma db execute \\
    --stdin \\
    --url="$DATABASE_URL"

  Like previous example, but exposing the datasource url credentials to your terminal history
  ${dim('$')} echo 'TRUNCATE TABLE dev;' | \\
    prisma db execute \\
    --stdin \\
    --url="mysql://root:root@localhost/mydb"
`)

  public async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--config': String,
        '--stdin': Boolean,
        '--file': String,
        '--schema': String,
        '--url': String,
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

    await loadEnvFile({ schemaPath: args['--schema'], printMessage: false, config })

    const cmd = 'db execute'

    checkUnsupportedSchemaEngineWasm({
      cmd,
      config,
      args,
      flags: ['--url'],
    })

    // One of --stdin or --file is required
    if (args['--stdin'] && args['--file']) {
      throw new Error(
        `--stdin and --file cannot be used at the same time. Only 1 must be provided. 
See \`${green(getCommandWithExecutor('prisma db execute -h'))}\``,
      )
    } else if (!args['--stdin'] && !args['--file']) {
      throw new Error(
        `Either --stdin or --file must be provided.
See \`${green(getCommandWithExecutor('prisma db execute -h'))}\``,
      )
    }

    // One of --url or --schema is required
    if (args['--url'] && args['--schema']) {
      throw new Error(
        `--url and --schema cannot be used at the same time. Only 1 must be provided.
See \`${green(getCommandWithExecutor('prisma db execute -h'))}\``,
      )
    } else if (!args['--url'] && !args['--schema']) {
      throw new Error(
        `Either --url or --schema must be provided.
See \`${green(getCommandWithExecutor('prisma db execute -h'))}\``,
      )
    }

    let script = ''
    // Read file
    if (args['--file']) {
      try {
        script = fs.readFileSync(path.resolve(args['--file']), 'utf-8')
      } catch (e) {
        if (e.code === 'ENOENT') {
          throw new Error(`Provided --file at ${args['--file']} doesn't exist.`)
        } else {
          console.error(`An error occurred while reading the provided --file at ${args['--file']}`)
          throw e
        }
      }
    }
    // Read stdin
    if (args['--stdin']) {
      script = await streamConsumer.text(process.stdin)
    }

    let datasourceType: EngineArgs.DbExecuteDatasourceType

    // Execute command(s) to url passed
    if (args['--url']) {
      checkUnsupportedDataProxy({ cmd, urls: [args['--url']] })

      datasourceType = {
        tag: 'url',
        url: args['--url'],
      }
    }
    // Execute command(s) to url from schema
    else {
      // validate that schema file exists
      // throws an error if it doesn't
      const schemaContext = await loadSchemaContext({
        schemaPathFromArg: args['--schema'],
        schemaPathFromConfig: config.schema,
        printLoadMessage: false,
      })

      checkUnsupportedDataProxy({ cmd, schemaContext })

      // Execute command(s) to url from schema
      datasourceType = {
        tag: 'schema',
        ...toSchemasContainer(schemaContext.schemaFiles),
        configDir: schemaContext.primaryDatasourceDirectory,
      }
    }

    const adapter = await config.adapter?.()
    const migrate = await Migrate.setup({ adapter })

    try {
      await migrate.engine.dbExecute({
        script,
        datasourceType,
      })
    } finally {
      await migrate.stop()
    }

    return `Script executed successfully.`
  }

  public help(error?: string): string | HelpError {
    if (error) {
      throw new HelpError(`\n${error}\n\n${helpOptions}`)
    }
    return DbExecute.help
  }
}
