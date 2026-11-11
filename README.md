# Otools LingChat / 灵伴

An independent AGPL desktop-companion plugin derived from [LingChat](https://github.com/SlimeBoyOwO/LingChat), using **Otools custom windows and the host AI configuration**.

## Scope

- Separate saves and per-character persistent memory, chat streaming and cancellation.
- Character ZIP import, outfits, emotion-tag dialogue, local optional ONNX emotion model.
- Safe YAML stories with multiple roles, choices, chapter routes, media and achievements.
- Original companion artwork, interaction sounds and an optional VITS simple-api service.
- Permissioned plugin data channel; Notes is the first provider.
- Host-owned background reminders while Otools runs; no duplicate task/calendar/pomodoro manager.
- Explicit, default-off screen observation with a separate visible host stop indicator.

## Build and preview

Requires Node >=22.12 and pnpm. This repository includes a pinned portable SDK package; it does not build from sibling host source paths.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm pack
```

The build copies local ONNX runtime assets from the installed dependency. It does **not** download emotion or voice weights.

```sh
pnpm dev
# Open http://127.0.0.1:5995/?preview=1 for an explicitly labelled interaction fixture.
```

Preview replies are examples, not live AI. Launch without `preview=1` from Otools to use actual host services. An older host without these APIs reports unavailable instead of selecting a different provider.

## Install in Otools

Build `dist-pack/otools-lingchat-0.1.0.oplg`, then use Otools local plugin installation. Development management can bind this repository's `plugin.json` and use the configured development URL.

The companion requires the host changes and SDK service types listed in `integration/`. Build/update the host before trying AI/data/observation. The companion has no AI API-key settings: configure the model in Otools, then check the connection from the plugin.

For Notes, first open the updated Notes plugin to migrate its existing origin-local records. Backups remain untouched. In **Plugin connections**, choose the currently listed providers and data types, then click **Connect selected data**. One host-owned consent window covers that explicit selection. Waiting for consent is not a connection: data appears only after approval and a successful authorized read. Denial, closing the consent window, or expiry ends the wait; a newly installed provider is never included automatically. Disconnect in the companion or revoke in Otools Settings → Data sharing. Enable background reminders separately.

MCP tool access is independent of data sharing. Enabled MCP plugins default to Recommended, including ordinary writes; only tools explicitly listed as sensitive are excluded. Existing Off or Custom choices are preserved. Tool recommendation does not automatically authorize plugin-data records, MCP resources, prompts or screen observation.

## Privacy

Data sharing is default-deny per consumer/provider/source. Changes are retrieved through authorized host calls, never plaintext global events. External note context and screen observations are not saved to chat or memory by default. Model requests go to the service configured in Otools; enabling observation discloses this in the native host consent surface.

Screen observation is off until explicitly authorized. The visible host indicator has a stop action. Closing the companion, losing the indicator, revoking OS permission, locking/sleeping or exiting the host stops the session. Initial continuous-observation safety support is macOS only; other platforms report unsupported rather than offering an unverified silent monitor.

Reminders stop when Otools exits. No operating-system service runs after exit. System fallback notifications do not reveal full private note content.

## Assets, models and compatibility

Only import resources you have permission to use. The base package has original art/sounds and no upstream restricted sprites, game audio, Live2D proprietary runtime, voice model or emotion weights.

Character ZIP: `settings.yml`, `avatar/`, optional outfit folders. Story ZIP: `story_config.yaml`, `Chapters/*.yaml`, optional safe assets and story characters. Unsafe paths, symlinks, executable files, LFS pointer media and unsupported script instructions are rejected. ZIP is supported; 7z, old LingChat save migration and Live2D execution are not.

Emotion model import requires `model.onnx`, `vocab.txt` and `label_mapping.json`. Missing weights are explicitly reported. VITS supports common simple-api POST dialects; no arbitrary server dialect is claimed.

See [UPSTREAM.md](UPSTREAM.md) for the exact revision, adaptation map and limitations, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency/resource terms, and [LICENSE](LICENSE) for AGPL.

## Corresponding source

Source target: https://github.com/ootools/otools-lingchat . Release packages must link to the corresponding source revision and include this repository's build scripts, dependency lockfile, SDK source and host integration source/patches. Do not publish private saves, imported assets or credentials.

## Optional host Agent mode

Agent / tools mode is off by default. When explicitly enabled, LingChat uses the host-managed Codex or ACP service for foreground messages and only selected, currently authorized plugin tools. Codex uses this plugin's model and reasoning selection; ACP/native profiles retain their native configuration. Session/run links are separate from exported saves and permanent memory. Temporary notes and captures continue through ordinary AI for that turn. Closing, stopping or switching save/role cancels and closes owned foreground work. Requires an updated Otools host; real model inference and ACP task acceptance have not been performed.
