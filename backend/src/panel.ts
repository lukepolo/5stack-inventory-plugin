// Talking to the panel as the administrator who is looking at the page.
//
// The plugin owns an `inventory` schema and nothing else. Anything that belongs
// to 5stack -- the game plugin catalog, the config rows a game server execs --
// is changed by asking the panel, over the same session cookie the browser
// already sent, so the panel's own permissions decide whether it happens. The
// alternative, writing `public.*` over the plugin's Postgres connection, works
// right up until it writes something the panel would have refused.

const GRAPHQL_URL =
  process.env.FIVESTACK_GRAPHQL_URL ??
  "http://hasura.5stack.svc.cluster.local:8080/v1/graphql";

export const GAME_PLUGIN_SLUG = "inventory-simulator";

export type GamePluginState = {
  inCatalog: boolean;
  installed: boolean;
  installState: string | null;
  runtimes: Array<string>;
  // The plugin cannot make its calls while Valve's server guidelines are on,
  // and the panel needs a separate per-plugin opt-in to turn them off. Without
  // it the plugin installs, configures, and quietly does nothing.
  requiresGuidelinesDisabled: boolean;
  guidelinesDisabled: boolean;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function query<T>(
  cookie: string,
  body: { query: string; variables?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`panel returned ${response.status}`);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("panel returned no data");
  }

  return payload.data;
}

// Whether this panel is new enough to have somewhere better to put the cvars
// than the individual type configs. An older one has neither, and the caller
// falls back to what it has always done.
//
// Probed by asking for the thing rather than by introspecting the schema: a
// panel can have introspection turned off, and reading that as "no Global
// config" would quietly send every operator back to the three-config path.
// A query that names a column or enum value the panel does not have is a
// GraphQL error, which is exactly the signal.
export async function panelCapabilities(cookie: string): Promise<{
  pluginConfig: boolean;
  globalConfig: boolean;
}> {
  const [pluginConfig, globalConfig] = await Promise.all([
    probe(() => readPluginCfg(cookie)),
    probe(() => readTypeCfgs(cookie, ["Global"])),
  ]);

  return { pluginConfig, globalConfig };
}

async function probe(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

export async function gamePluginState(
  cookie: string,
): Promise<GamePluginState> {
  const ranksRead = rankSettings(cookie);
  const data = await query<{
    game_plugins: Array<{
      slug: string;
      install_state: string | null;
      requires_server_guidelines_disabled: boolean;
      versions: Array<{ runtime: string }>;
    }>;
    game_plugin_installs: Array<{
      plugin_slug: string;
      disable_server_guidelines: boolean;
    }>;
  }>(cookie, {
    query: `query pluginState($slug: String!) {
      game_plugins(where: { slug: { _eq: $slug } }) {
        slug
        install_state
        requires_server_guidelines_disabled
        versions { runtime }
      }
      game_plugin_installs(where: { plugin_slug: { _eq: $slug } }) {
        plugin_slug
        disable_server_guidelines
      }
    }`,
    variables: { slug: GAME_PLUGIN_SLUG },
  });

  const plugin = data.game_plugins?.[0] ?? null;
  const install = data.game_plugin_installs?.[0] ?? null;
  const ranks = await ranksRead;

  return {
    inCatalog: Boolean(plugin),
    installed: Boolean(install),
    installState: plugin?.install_state ?? null,
    runtimes: [
      ...new Set((plugin?.versions ?? []).map((version) => version.runtime)),
    ],
    requiresGuidelinesDisabled: Boolean(
      plugin?.requires_server_guidelines_disabled,
    ),
    guidelinesDisabled: guidelinesAlreadyOff(
      Boolean(install?.disable_server_guidelines),
      ranks,
    ),
  };
}

// 5stack Ranks turns the same setting off for the servers matches run on, and
// the panel's plugin page then says "already off" instead of offering a switch.
// The same two settings the page reads.
const RANKS_SETTINGS = ["fivestack_ranks_matches", "fivestack_ranks_tournaments"];

export function guidelinesAlreadyOff(
  pluginTurnedThemOff: boolean,
  settings: Array<{ name: string; value: string | null }>,
): boolean {
  return (
    pluginTurnedThemOff ||
    settings.some((setting) => RANKS_SETTINGS.includes(setting.name) && setting.value === "true")
  );
}

// Apart from gamePluginState's query, and never fatal: a panel that hides
// settings from this role must still show the Game Server tab.
async function rankSettings(
  cookie: string,
): Promise<Array<{ name: string; value: string | null }>> {
  try {
    const data = await query<{ settings: Array<{ name: string; value: string | null }> }>(cookie, {
      query: `query rankSettings {
        settings(where: { name: { _in: ${JSON.stringify(RANKS_SETTINGS)} } }) {
          name
          value
        }
      }`,
    });
    return data.settings ?? [];
  } catch {
    return [];
  }
}

export async function installGamePlugin(cookie: string): Promise<void> {
  await query(cookie, {
    query: `mutation install($slug: String!) {
      installGamePlugin(slug: $slug) { success }
    }`,
    variables: { slug: GAME_PLUGIN_SLUG },
  });
}

export async function readPluginCfg(cookie: string): Promise<string | null> {
  const data = await query<{
    game_plugin_installs: Array<{ cfg: string | null }>;
  }>(cookie, {
    query: `query pluginCfg($slug: String!) {
      game_plugin_installs(where: { plugin_slug: { _eq: $slug } }) { cfg }
    }`,
    variables: { slug: GAME_PLUGIN_SLUG },
  });

  return data.game_plugin_installs?.[0]?.cfg ?? null;
}

// The load targets as well as the cvars: a player's skins have to follow them
// onto whatever they play, and that is not something a game mode selects. All
// three, because the panel's own default is to load nowhere -- writing only the
// cvars would configure a plugin that never loads.
export async function writePluginCfg(
  cookie: string,
  cfg: string,
): Promise<void> {
  const data = await query<{
    update_game_plugin_installs_by_pk: { plugin_slug: string } | null;
  }>(cookie, {
    query: `mutation setPluginCfg($slug: String!, $cfg: String!) {
      update_game_plugin_installs_by_pk(
        pk_columns: { plugin_slug: $slug }
        _set: {
          cfg: $cfg
          load_ranked: true
          load_tournaments: true
          load_custom: true
        }
      ) { plugin_slug }
    }`,
    variables: { slug: GAME_PLUGIN_SLUG, cfg },
  });

  if (!data.update_game_plugin_installs_by_pk) {
    throw new Error(
      `${GAME_PLUGIN_SLUG} is not installed on this panel, so there is nowhere to write its cvars`,
    );
  }
}

export async function readTypeCfgs(
  cookie: string,
  types: Array<string>,
): Promise<Record<string, string>> {
  const data = await query<{
    match_type_cfgs: Array<{ type: string; cfg: string }>;
  }>(cookie, {
    query: `query typeCfgs($types: [e_game_cfg_types_enum!]) {
      match_type_cfgs(where: { type: { _in: $types } }) { type cfg }
    }`,
    variables: { types },
  });

  return Object.fromEntries(
    (data.match_type_cfgs ?? []).map((row) => [row.type, row.cfg]),
  );
}

export async function writeTypeCfg(
  cookie: string,
  type: string,
  cfg: string,
): Promise<void> {
  await query(cookie, {
    query: `mutation setTypeCfg($type: e_game_cfg_types_enum!, $cfg: String!) {
      insert_match_type_cfgs_one(
        object: { type: $type, cfg: $cfg }
        on_conflict: { constraint: match_type_cfgs_pkey, update_columns: [cfg] }
      ) { type }
    }`,
    variables: { type, cfg },
  });
}

export async function deleteTypeCfg(
  cookie: string,
  type: string,
): Promise<void> {
  await query(cookie, {
    query: `mutation dropTypeCfg($type: e_game_cfg_types_enum!) {
      delete_match_type_cfgs_by_pk(type: $type) { type }
    }`,
    variables: { type },
  });
}

export type PlayerCard = { name: string; avatar: string | null };

/**
 * Players as the panel shows them — name and picture — for the Craft Store's
 * authors. One query for a page of them, asked live with the viewer's own
 * session, so a renamed player reads right everywhere at once rather than
 * wearing the name they had when they published.
 *
 * Only an http(s) picture is passed on: the client puts it in an <img>.
 */
export async function playerCards(
  cookie: string,
  steamIds: Array<string>,
): Promise<Map<string, PlayerCard>> {
  if (!steamIds.length) return new Map();
  const data = await query<{
    players: Array<{ steam_id: string; name: string | null; avatar_url: string | null; custom_avatar_url: string | null }>;
  }>(cookie, {
    query: `query playerCards($ids: [bigint!]) {
      players(where: { steam_id: { _in: $ids } }) { steam_id name avatar_url custom_avatar_url }
    }`,
    variables: { ids: steamIds },
  });
  const web = (u: string | null) => (u && /^https?:\/\//.test(u) ? u : null);
  return new Map(
    (data.players ?? []).map((p) => [
      String(p.steam_id),
      { name: p.name || "Player", avatar: web(p.custom_avatar_url) ?? web(p.avatar_url) },
    ]),
  );
}
