# Changelog

## [0.1.0](https://github.com/Vizards/DotX/compare/v0.0.1...v0.1.0) (2026-10-30)


### ⚠ BREAKING CHANGES

* upgrading from 0.0.1 requires a fresh DotX Server installation, Desktop enrollment and Personal Agent authorization. The wire protocol changes from 4 to 5. Native Codex accounts, projects and conversations are preserved.

### Features

* redesign DotX authentication and client enrollment ([#3](https://github.com/Vizards/DotX/issues/3)) ([d60dac5](https://github.com/Vizards/DotX/commit/d60dac59522eff1e875f8a0f8e49468c46233599))

## 0.0.1 (2026-10-22)


### Features

* add opt-in dev release discovery ([986da52](https://github.com/Vizards/DotX/commit/986da52171641166bbbf3b132c80b303b15aec65))
* expose DotX usage instructions as a tool ([bb9039b](https://github.com/Vizards/DotX/commit/bb9039b26fb3b7ea3b8c5271b7b5f051df66d70d))
* initialize DotX desktop and self-hosted MCP service ([17f51a7](https://github.com/Vizards/DotX/commit/17f51a7d20e6920403ba322bea0e14f2115c8bc8))
* load MCP guidance by task goal ([7659c34](https://github.com/Vizards/DotX/commit/7659c343404d0eadde7de481f5ef29dbc739dbbc))
* prepare Personal Agent onboarding and product branding ([965af00](https://github.com/Vizards/DotX/commit/965af00a27215837a3ed1a2ce29cd0f8ffce0e3f))
* simplify authorization pages and grant full DotX access ([1b0e38e](https://github.com/Vizards/DotX/commit/1b0e38ede107d7ebe1888d505911e4a695385fc7))


### Bug Fixes

* clarify native activation and support RC prereleases ([7f6af94](https://github.com/Vizards/DotX/commit/7f6af947b80e5ce3b01d8e953cac5a9379777694))
* coordinate update permissions before delegating work ([54db915](https://github.com/Vizards/DotX/commit/54db91558a65ceedf2eca2ddd5a5119c0e4b80d0))
* describe opt-in discovery in prerelease notes ([0ef49d3](https://github.com/Vizards/DotX/commit/0ef49d365304958373e11dbf34bc1b258c5e9d5e))
* keep one active desktop connector per installation ([4f8f3f9](https://github.com/Vizards/DotX/commit/4f8f3f9e1f4dd823f6a8841b53001048ee642c93))
* link update guidance to web-readable release source ([876a532](https://github.com/Vizards/DotX/commit/876a5323332dcb382f3edfd7710dd2bc31881e75))
* preserve native fetch receiver in Workers discovery ([f5d1071](https://github.com/Vizards/DotX/commit/f5d1071bc5262c4d1ce5a1bb0094c364d53c4810))
* retire stale connector routes and clarify invocation guidance ([7a144b2](https://github.com/Vizards/DotX/commit/7a144b2e1d5cc85f9bfe9bbd8116b77c55144acf))
* scope event subscriptions to a single native turn ([9810ad8](https://github.com/Vizards/DotX/commit/9810ad81dfc09b658f1e66dcc743e7b6eeaddd6e))
* validate generated releases and upload correct asset types ([89077d9](https://github.com/Vizards/DotX/commit/89077d916bc02994c5b0be10f1761874f0c5403f))
