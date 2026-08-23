# Working in this repo

Read `PRD.md` first — it has the architecture, the stack decisions and the
reasoning behind them. `STACK-RESEARCH.md` has the model research those
decisions came from. `SETUP.md` gets you running.

## Before changing anything

- Expo SDK 57 / React Native 0.86. **VisionCamera v5 is a full API rewrite** —
  no `useFrameProcessor`, no `runAtTargetFps`. It uses `useCamera` and outputs
  (`usePreviewOutput`, `useFrameOutput`, `useDepthOutput`). Check the installed
  `.d.ts` files before trusting any tutorial or LLM memory; almost everything
  written about VisionCamera online is v4.
- Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/
- Do not swap a model or library without opening an issue first. The stack is
  chosen to fit together — see PRD.md section 5.

## Checks

```bash
npm test        # rate limiter logic
npm run typecheck
```
