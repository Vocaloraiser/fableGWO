import { Character } from './add_character_to_inventory.ts';

import {
  Client,
  fql,
  InstanceExpr,
  InventoryExpr,
  NumberExpr,
  RefExpr,
  ResponseExpr,
  StringExpr,
  UserExpr,
} from './fql.ts';

import {
  getGuild,
  getInstance,
  getInventory,
  getUser,
  Inventory,
  rechargePulls,
} from './get_user_inventory.ts';

export function replaceCharacters(
  {
    rating,
    mediaId,
    characterId,
    inventory,
    instance,
    user,
    pool,
    sacrifices,
  }: {
    rating: NumberExpr;
    mediaId: StringExpr;
    characterId: StringExpr;
    inventory: InventoryExpr;
    instance: InstanceExpr;
    user: UserExpr;
    pool: NumberExpr;
    sacrifices: StringExpr[];
  },
): ResponseExpr {
  return fql.Let({
    match: fql.Match(
      fql.Index('characters_instance_id'),
      characterId,
      fql.Ref(instance),
    ),
    sacrificedCharacters: fql.Map(sacrifices, (id) =>
      fql.Match(
        fql.Index('characters_instance_id'),
        id,
        fql.Ref(instance),
      )),
  }, ({ match, sacrificedCharacters }) =>
    fql.If(
      fql.LTE(fql.Select(['data', 'availablePulls'], inventory), 0),
      {
        ok: false,
        error: 'NO_PULLS_AVAILABLE',
        inventory: fql.Ref(inventory),
      },
      fql.If(
        fql.All(fql.Map(sacrificedCharacters, (char) =>
          fql.Equals(
            fql.Select(['data', 'user'], fql.Get(char)),
            fql.Ref(user),
          ))),
        fql.If(
          fql.IsEmpty(match),
          fql.Let(
            {
              sacrificedCharactersRefs: fql.Map(
                sacrificedCharacters,
                (char) => fql.Ref(fql.Get(char)),
              ),
              deletedCharacters: fql.Foreach(
                fql.Var<RefExpr[]>('sacrificedCharactersRefs'),
                fql.Delete,
              ),
              createdCharacter: fql.Create<Character>('character', {
                rating,
                mediaId,
                id: characterId,
                inventory: fql.Ref(inventory),
                instance: fql.Ref(instance),
                user: fql.Ref(user),
                history: [
                  {
                    gacha: {
                      sacrifices,
                      ts: fql.Now(),
                      by: fql.Ref(user),
                      pool,
                    },
                  },
                ],
              }),
              updatedInventory: fql.Update<Inventory>(fql.Ref(inventory), {
                lastPull: fql.Now(),
                rechargeTimestamp: fql.Select(
                  ['data', 'rechargeTimestamp'],
                  inventory,
                  fql.Now(),
                ),
                availablePulls: fql.Subtract(
                  fql.Select(['data', 'availablePulls'], inventory),
                  1,
                ),
                characters: fql.Append(
                  fql.Ref(fql.Var('createdCharacter')),
                  fql.RemoveAll(
                    fql.Var<RefExpr[]>('sacrificedCharactersRefs'),
                    fql.Select(['data', 'characters'], inventory),
                  ),
                ),
              }),
            },
            ({ updatedInventory, createdCharacter }) => ({
              ok: true,
              inventory: fql.Ref(updatedInventory),
              character: fql.Ref(createdCharacter),
              likes: fql.Select(
                ['data'],
                fql.Map(
                  fql.Paginate(
                    fql.Match(
                      fql.Index('users_likes_character'),
                      characterId,
                    ),
                    {},
                  ),
                  (user) => fql.Select(['data', 'id'], fql.Get(user)),
                ),
              ),
            }),
          ),
          { ok: false, error: 'CHARACTER_EXISTS' },
        ),
        {
          ok: false,
          error: 'CHARACTER_NOT_OWNED',
          inventory: fql.Ref(inventory),
        },
      ),
    ));
}

export default function (client: Client): {
  indexers?: (() => Promise<void>)[];
  resolvers?: (() => Promise<void>)[];
} {
  return {
    resolvers: [
      fql.Resolver({
        client,
        name: 'replace_characters',
        lambda: (
          userId: string,
          guildId: string,
          characterId: string,
          mediaId: string,
          rating: number,
          pool: number,
          sacrifices: string[],
          // guarantees: number[],
        ) => {
          return fql.Let(
            {
              user: getUser(userId),
              guild: getGuild(guildId),
              instance: getInstance(fql.Var('guild')),
              _inventory: getInventory({
                user: fql.Var('user'),
                instance: fql.Var('instance'),
              }),
              inventory: rechargePulls({
                inventory: fql.Var('_inventory'),
              }),
            },
            ({ inventory, instance, user }) =>
              replaceCharacters({
                rating,
                mediaId,
                characterId,
                inventory,
                instance,
                user,
                pool,
                sacrifices,
                // guarantees,
              }),
          );
        },
      }),
    ],
  };
}