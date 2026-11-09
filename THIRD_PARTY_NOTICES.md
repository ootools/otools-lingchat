# Third-party notices

## LingChat

Derived portions of this plugin are adapted from LingChat 0.5.2, revision `848fd3448c20ca32e0436a498d20e85f63393e7f`.

Copyright remains with LingChat's original authors and contributors, including SlimeBoyOwO. The code is distributed under GNU AGPL version 3; see `LICENSE` and `UPSTREAM.md`. Otools integration and modifications are dated 2026-11-10.

No original restricted character artwork, Blue Archive/Undertale resources, Git LFS pointer media, or model weights are bundled. No proprietary Live2D Core code is redistributed.

## Included dependencies

| Component | Version | License |
| --- | --- | --- |
| Otools plugin SDK | pinned upstream base b0bbcd98 plus documented companion-service modifications | MIT |
| Vue and runtime modules | lockfile versions, root Vue 3.5.27 | MIT |
| Tauri JavaScript API | 2.10.1 | MIT OR Apache-2.0 |
| Tauri dialog JavaScript API | 2.6.0 | MIT OR Apache-2.0 |
| fflate | 0.8.2 | MIT |
| yaml | 2.8.1 | ISC |
| ONNX Runtime Web/Common | 1.21.0 | MIT |
| ONNX Runtime bundled native/WebAssembly dependencies | runtime release notice | individual notices in `licenses/` |
| protobufjs and its helpers | dependency lockfile | BSD-3-Clause |
| long | dependency lockfile | Apache-2.0 |
| flatbuffers | dependency lockfile | Apache-2.0 |
| guid-typescript | dependency lockfile | MIT |

Complete available license texts and notices are copied to `licenses/` during preparation and included in the plugin package. Dependency versions are pinned in `pnpm-lock.yaml`. ONNX Runtime browser/WASM assets are generated into `public/onnx/` from the installed dependency and are not checked in as native binaries.

## Original port assets

The default cat mascot, default UI illustration/layout, and synthesized sine-wave interaction sounds were created for this port. They are distributed with this project's AGPL-3.0-only terms. System font stacks are used; no font binary is bundled.

## Imported assets and models

A character/model import is local data processing, not a statement that the resource is freely licensed. Users must have permission to use imported characters, art, music, models and voices. Public releases must not include user-imported private resources or saved conversations.
