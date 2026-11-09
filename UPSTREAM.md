# LingChat → Otools port provenance

- Upstream: https://github.com/SlimeBoyOwO/LingChat
- Inspected revision: `848fd3448c20ca32e0436a498d20e85f63393e7f`, application version 0.5.2.
- Code license: GNU Affero General Public License version 3. The unmodified upstream license text is preserved in `LICENSE`. This port declares its modifications under AGPL-3.0-only; original applicable copyright notices remain effective.
- Modifications: Otools contributors, 2026-11-10. New integration code replaces the upstream application shell, provider settings, Tauri window/capture transport, and excluded productivity modules with Otools capabilities.

## Adaptation map

| Upstream module | Port |
| --- | --- |
| `src/components/views/PetMode.vue`, `src/components/pet/` | `src/composables/useCompanion.ts`, application shell and original mascot |
| `src-tauri/src/ai_service/types.rs`, `src-tauri/src/api/character.rs` | `src/characters/`: `settings.yml`, emotion sprites, outfit and interaction data |
| `src-tauri/src/api/role_archive/` | Safe ZIP import in `src/characters/archive.ts` (ZIP supported; 7z is not) |
| `src-tauri/src/ai_service/message_system/processor.rs` | `src/dialogue/protocol.ts`: emotion, speech/translation and action tags |
| `src-tauri/src/ai_service/emotion/classifier.rs` | `src/emotion/`: 128-token character tokenizer, float attention mask, ONNX logits/softmax and threshold |
| `src-tauri/src/ai_service/game_system/persistent_memory_system.rs` | `src/memory/`: four summary sections scoped by save and role |
| `src-tauri/src/ai_service/game_system/script_engine/` | `src/scripts/`: YAML chapters, actions, choices, conditions, characters, media and achievements |
| `src-tauri/src/api/pet.rs` | Existing Otools custom-window mode and SDK window APIs |

This is a focused derivative port, not a mirror of the upstream desktop application. The original settings application, schedule/pomodoro/todo UIs, Python plugin runtime, updater, mobile packaging and arbitrary executable script integrations are excluded.

## Compatibility and explicit limits

- Character ZIPs: `settings.yml`, `avatar/<emotion>.*` and `avatar/<outfit>/<emotion>.*`, clothes object lists and body-region metadata. User-supplied SVG/HTML/executables, symlinks, path traversal and Git LFS pointer assets are rejected.
- Stories: `story_config.yaml`, case-sensitive `Chapters/**/*.yaml`; 17 documented desktop story event types. Conditions support bare variables, `==` and `!=` as in the inspected upstream. Unsupported actions are rejected at import, not skipped.
- New save/memory archives are independent of upstream SQLite saves. Old LingChat saves are not migrated.
- Emotion inference normalizes the LLM emotion tag, matching upstream, rather than claiming to infer arbitrary human emotions from a reply. The required `model.onnx`, `vocab.txt`, and `label_mapping.json` are **not included**. Import only models you have permission to use. Without them, tags are preserved and the UI states that model inference is unavailable.
- VITS support targets common simple-api HTTP POST services; no voice weights or voice-cloning models are bundled.
- Live2D metadata is retained only as data. Proprietary Live2D Core and models are not shipped or executed.
- Continuous screen observation is implemented by the updated Otools host with explicit consent and an independent visible indicator. The initial safety monitor supports macOS; other OSes must report unsupported until their lock/sleep safety paths are implemented and tested.
- Chat, vision, screenshots, data sharing and background reminders require the companion host/SDK changes shipped alongside this port; an older host must report unavailable, not silently use another AI configuration.

## Asset policy

The inspected upstream archive mostly contains Git LFS pointers for character sprites, backgrounds, audio and fonts. Its `.github/README.md` also explicitly restricts default artwork and game-derived sounds. Those resources are **not redistributed**.

The default mascot, default UI, and synthesized interaction tones are original Otools port assets. No Blue Archive, Undertale, upstream character artwork, Live2D proprietary runtime, voice model, or emotion weight is included. Imported assets remain the user's responsibility; import does not imply redistribution rights.

## Source availability

Public source target: https://github.com/ootools/otools-lingchat

The corresponding source includes application code, tests, dependency lockfile, SDK source and notices, and build/packaging scripts. Releases must identify their source revision. Building the plugin uses no upstream model downloads or remote inference runtime CDN. Host integration source and its exact patches are provided in the integration directory before binary distribution.
