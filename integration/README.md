# Integration patches for the Otools host

This plugin is a companion for an **updated Otools host**. Three patch sets add the
required host capabilities. They apply to the corresponding upstream bases and are
provided as the corresponding source for any plugin binary built against them.

| Patch | Base revision | Content |
| --- | --- | --- |
| `host.patch` | OTools `8ff6e9d6` (`feat/panel-launcher`) | `ot-plugin-data` broker crate, `plugin_data` service (consent/management windows, identity, transport), `plugin_reminders` background watcher, `observation` consent surface, host AI conversation jobs (streaming + cancellation), Notes shared persistence/migration, SDK service injection, settings "Data sharing" tab, command registration and ACLs |
| `sdk.patch` | `otools-plugin-sdk` `b0bbcd9` | `ai-factory`, `plugin-data-factory`, `observation-factory`, `reminder-factory`, service injection sync script and tests |
| `remote.patch` | `tauri-remote-service` `7fbbf2a` | Blocks generic remote forwarding of identity-bound commands (`otools_host_plugin_data_*`, `otools_host_ai_*`, `otools_host_observation_*`, `otools_host_plugin_reminders_*`) and validates command names before WebView evaluation |

Apply with `git apply integration/<name>.patch` inside each repository, then build.
New files are included in the patches (`git add -N` intent-to-add). The host patch
merges cleanly with additive concurrent changes; overlapping hunks keep both sides.

Capabilities delivered by these patches (all verified in this task):

- Broker core: 13 tests (`broker` 7, `consent` 4, `policy` 2) — default-deny grants,
  source+UUID identity, private-field redaction, CAS/tombstones, cursor binding,
  durable revocation, bounded consent queues.
- Host AI: 8 tests — multimodal wire requests, host-only credentials, ordered SSE,
  stalled-connection cancellation, private bounded queues, owner checks.
- Notes: 120 frontend tests including migration, tombstones, concurrent editors,
  committed-edit races and failure recovery.
- SDK: 110 tests; host `cargo check -p OTools --lib` and full frontend build green.

Privacy behavior: consent/management UIs run in dedicated native views with
single-use bootstrap tokens injected after page load; grants are default-deny;
background reminder reads reauthorize every tick; observation has an independent
visible indicator with heartbeat, lock/sleep safety (macOS) and one-click stop;
remote forwarding cannot impersonate a local plugin or consent view.
