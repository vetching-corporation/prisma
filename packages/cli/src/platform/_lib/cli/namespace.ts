import { Command, Commands } from '@prisma/internals'
import type { PrismaConfigInternal } from '@vetching-corporation/prisma-config'

import { dispatchToSubCommand } from './dispatchToSubCommand'

export const createNamespace = () => {
  return class $ implements Command {
    public static new(commands: Commands): $ {
      return new $(commands)
    }

    private constructor(public readonly commands: Commands) {}

    public async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
      return await dispatchToSubCommand(this.commands, argv, config)
    }
  }
}
