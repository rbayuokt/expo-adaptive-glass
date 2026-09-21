# Expo Adaptive Glass

Glass surfaces for Expo and React Native that decide how much glass the phone can afford right
now. A new iPhone gets Apple's system glass, a mid-range Android gets live blur with a lens
shader, and an old or overheating phone gets a flat acrylic material that still looks
intentional. When frames start dropping, the phone gets hot or Low Power Mode kicks in, quality
steps down on its own, and it climbs back once things calm down.

You don't pick a renderer. You mark what matters (`priority="critical"` for a tab bar,
`normal` for list cards) and the library spends the GPU budget in that order.

```tsx
import { GlassProvider, GlassSurface } from 'expo-adaptive-glass';

export default function App() {
  return (
    <GlassProvider>
      <GlassSurface priority="high" interactive>
        <Text>Hello Glass</Text>
      </GlassSurface>
    </GlassProvider>
  );
}
```

On top of the plain surface there's a lens tab bar (`GlassTabBar`), glass that melts together
and pulls apart (`GlassGroup`), and a built-in `draggable` prop. None of them need Reanimated or
Gesture Handler.

## Install

```bash
npx expo install expo-adaptive-glass
npx expo run:ios        # or run:android, or an EAS build
```

It ships Swift and Kotlin, so it needs a development build. No config plugin and no
permissions.

| Where | What you get |
| --- | --- |
| Expo Go | A static translucent `View` and a dev warning saying why |
| Development build / EAS | Everything |
| Bare React Native | Should work once Expo Modules are installed (`npx install-expo-modules`), not tested yet |
| Web | Static translucent fallback |

### Expo SDK support

`expo` is a `*` peer. The native side only uses Expo Modules APIs that have been around for
several SDKs (`View`, `Prop`, `Events`, `OnViewDidUpdateProps`, `OnStartObserving`, one view per
module), and the JS side imports `requireNativeView` and `requireOptionalNativeModule` from
`expo`, so SDK 52 is the floor.

What has actually been built and run so far:

| SDK | Where | Result |
| --- | --- | --- |
| 57 (RN 0.86) | Android emulator (API 36) and an OPPO CPH2217 (Android 13) | Builds and runs |
| 55 (RN 0.83) | iOS 26.1 simulator, Xcode 26.1 | Builds and runs, system glass active |
| 57 | iOS with Xcode 26.1 | Expo's own `expo-modules-jsi` needs a newer Swift, not this package |

The iOS 26 code is behind `#if compiler(>=6.2)`, so older Xcode versions still compile it and
just never pick the system renderer.

## Tech stack

| Layer | What it uses |
| --- | --- |
| JS API | TypeScript, React hooks, `useSyncExternalStore` so a surface only re-renders when its own allocation changes |
| Quality policy | Plain TypeScript in `src/quality/`, no React or native imports, covered by Jest |
| Native bridge | Expo Modules API (Swift and Kotlin DSL), one module per native view |
| iOS glass | `UIGlassEffect` and `UIGlassContainerEffect` on iOS 26, `UIVisualEffectView` blur materials before that, Core Animation layers for tint, rim and highlight |
| iOS lens | Metal, a fragment shader compiled from source at runtime |
| iOS timing | `CADisplayLink`, `ProcessInfo` thermal and power state, `UIAccessibility` |
| Android glass | `RenderNode` and `RenderEffect` blur (API 31+), AGSL `RuntimeShader` (API 33+), `Paint` and gradients for acrylic |
| Android timing | `Window.OnFrameMetricsAvailableListener`, `PowerManager` thermal and power-save state, `onTrimMemory` |
| Motion | Hand-rolled critically damped springs on both platforms, driven by `postOnAnimation` on Android and a display link on iOS |
| Example app | Expo SDK 57, Reanimated 4, expo-image, expo-linear-gradient, @expo/vector-icons |

Native code measures and draws. It never decides a tier. Every decision comes from the
TypeScript policy, which is why the whole thing is testable without a device.

## Renderers

| Platform | Renderer | Drawn with |
| --- | --- | --- |
| iOS 26+ | `system` | `UIGlassEffect`, corners through `cornerConfiguration` |
| iOS 15.1 to 25, or apps setting `UIDesignRequiresCompatibility` | `nativeBlur` | `UIBlurEffect` materials plus tint, sheen and rim layers |
| Android 13+ | `shaderGlass` | Backdrop `RenderNode` → blur `RenderEffect` → AGSL lens |
| Android 12 | `nativeBlur` | Backdrop `RenderNode` → blur `RenderEffect` |
| Android 11 and older, or `isLowRamDevice()` | `acrylic` | Semi-opaque fill, sheen, gradient hairline, static highlight |

`acrylic` is also every platform's low tier. If the AGSL shader fails to compile, the surface
drops to plain blur and stays there instead of crashing.

## Android needs a backdrop

iOS blurs whatever is behind a view for free. Android doesn't: `RenderEffect` on a view blurs the
view's own content, so it would blur the card's text instead of the wallpaper. On Android you
mark the content to blur:

```tsx
<View style={{ flex: 1 }}>
  <GlassBackdrop style={StyleSheet.absoluteFill}>
    <Image source={wallpaper} style={StyleSheet.absoluteFill} />
  </GlassBackdrop>

  <FlatList data={items} renderItem={() => <GlassSurface>...</GlassSurface>} />
  <GlassSurface priority="critical" style={styles.tabBar}>...</GlassSurface>
</View>
```

The backdrop draws itself through a `RenderNode`, and every surface reuses that node inside its
own small blur node. The backdrop is recorded once per frame however many surfaces sample it.

- Surfaces go next to the backdrop, in front of it, never inside it.
- A surface with no backdrop behind it draws `acrylic` and says so in diagnostics.
- On iOS `GlassBackdrop` is a plain `View`, so one tree works on both platforms.

## Components

### `<GlassProvider>`

| Prop | Default | Does |
| --- | --- | --- |
| `quality` | `'auto'` | `'auto'` adapts. Any tier (`'ultra'` to `'minimal'`) pins every surface and stops adapting |
| `maxLiveSurfaces` | none | Cap on surfaces with live blur. The tier's own limit (12 / 10 / 6 / 0 / 0) still applies |
| `adaptivePerformance` | `true` | React to measured frame times |
| `respectLowPowerMode` | `true` | Cap at `medium` in Low Power Mode and Battery Saver |
| `respectReduceTransparency` | `true` | Opaque material when the setting is on |

It's optional. Surfaces outside a provider share one with these defaults.

### `<GlassSurface>`

| Prop | Default | Does |
| --- | --- | --- |
| `priority` | `'normal'` | `'critical'`, `'high'`, `'normal'`, `'low'` or `'decorative'`, who keeps live glass when the budget runs out |
| `quality` | `'auto'` | Pin this one surface to a tier. Platform limits still apply |
| `intensity` | `0.6` | How strongly tint and sheen read, 0 to 1 |
| `tint` | `'system'` | `'system'`, `'light'`, `'dark'` or any color |
| `cornerRadius` | `24` | Anything over half the short side becomes a capsule |
| `refraction` | `true` | Allow edge bending where the tier has it |
| `interactive` | `false` | Native press: swell, lean toward the finger, light under it |
| `draggable` | `false` | Follows the finger natively and springs back on release. A scroll view around it waits for the drag |
| `onInteractionStart` / `onInteractionEnd` | | Once per press |
| `onDragStart` / `onDragEnd` | | Once per drag. `onDragEnd` gets `{ x, y }`, the release offset in points |

Plus normal `View` props. Children are ordinary React Native views, so `Text`, `Pressable` and
`expo-image` work as usual. Touch coordinates never go through JS.

The press and the drag are transforms on an inner native view (`setAnimationMatrix` on
Android), so your own `transform` style is left alone and nothing gets re-blurred per frame.
Everything settles on critically damped springs: smooth, no bounce. A press ends when the
finger lifts or when a list around it starts scrolling. `UIGlassEffect.isInteractive` isn't
used because it never reacted with React Native content inside the glass on iOS 26.1.

### `<GlassTabBar>`

```tsx
<GlassTabBar selectedIndex={tab} onSelect={setTab}>
  {tabs.map((t, i) => (
    <View key={t.label} style={{ alignItems: 'center' }}>
      <Ionicons name={t.icon} size={22} color={i === tab ? accent : text} />
      <Text>{t.label}</Text>
    </View>
  ))}
</GlassTabBar>
```

The selected tab sits on a soft pill that fills its slot. Hold the bar and the pill lifts into a
clear lens about 1.18× the bar's height, spilling over the top and bottom. The middle of the lens
magnifies what's under it (1.2×), the rim bends it like the edge of real glass, and the whole bar
swells a little. Drag and the lens follows, stretching with speed. Let go and it shrinks back
into the pill on the nearest tab. JS hears `onSelect(index)` once, on release.

| Prop | Default | Does |
| --- | --- | --- |
| `selectedIndex` | | Controlled selection |
| `onSelect` | | Called with the new index |
| `tint` | `'system'` | Same as `GlassSurface` |
| `cornerRadius` | `999` | Capsule |
| `intensity` | `0.7` | Background glass intensity |

How the lens is drawn:

- Android replays the tab items' existing display lists into a capsule `RenderNode` at the lens
  scale. Android 13+ runs the AGSL lens over it (bending band about 28% of the height, slight
  colour fringe). Android 9 and older use a clipped canvas.
- iOS renders the tab row to a Metal texture once per press, then only the shader's uniforms
  change while the lens moves. Same lens profile as Android. Without refraction, or without
  Metal, it falls back to a scaled `snapshotView`.
- The magnified copy stays opaque while the lens settles, shrinking onto the real tabs, so
  nothing blinks on release.
- The lens is cheap, so it shows on every tier except `minimal`. Bending only runs where
  refraction is on (`high` and `ultra`). `minimal`, Reduce Transparency and Reduce Motion get
  the plain sliding pill.

### `<GlassGroup>`

```tsx
<GlassGroup spacing={20} style={{ flexDirection: 'row', gap: 40 }}>
  <GlassSurface cornerRadius={40} style={{ width: 80, height: 80 }} />
  <GlassSurface draggable cornerRadius={40} style={{ width: 80, height: 80 }} />
</GlassGroup>
```

Surfaces in a group melt into one shape when they get within `spacing` of each other and pull
apart through a stretching bridge when they separate. There's nothing to call: drag a
`draggable` surface into another, press an `interactive` one so it leans over, or move surfaces
with Reanimated or layout, and the group follows them natively every frame. Members can be at
any depth inside the group.

| Prop | Default | Does |
| --- | --- | --- |
| `spacing` | `20` | How close two surfaces get before they merge |
| `tint` / `intensity` | `'system'` / `0.6` | Used where the group draws the merged glass itself |

| Platform | How it merges | Cost |
| --- | --- | --- |
| iOS 26 | Apple's `UIGlassContainerEffect` | Nothing extra |
| Android 13+ | One AGSL pass: smooth union of the members' rounded rects over the shared blurred backdrop | GPU, only over the members' bounds |
| iOS 15 to 25 | Same smooth union as a small CPU-drawn mask over one blur view | Half resolution, only in frames where a member moved |
| Android 12 and older | No merge | Same as plain surfaces |

Up to eight members merge on Android. On iOS, don't animate the opacity of a view that holds
glass, `UIVisualEffectView` stops rendering inside it. Fade the content instead.

### Hooks

| Hook | Returns | Re-renders |
| --- | --- | --- |
| `useGlassQuality()` | `{ quality, requestedQuality, renderer, downgradeReason }` | When the tier or reason changes |
| `useGlassCapabilities()` | Renderer, live blur, refraction, blur radius, live surface cap, shader quality, refresh rate | When the tier changes |
| `useGlassPerformance()` | Frame times, dropped ratio, fps, visible surfaces and area, thermal, power, memory, accessibility, scroll state | About twice a second, meant for dev screens |

`getGlassDeviceInfo()` returns the static facts the policy starts from (RAM, OS, screen,
refresh rate, renderer support), or `null` without the native module.

## How quality is picked

Device score → thermal, power and memory caps → frame feedback → per-surface budget → scroll
and accessibility tweaks → native props.

**Device score.** 0 to 100 from RAM, OS version, the best renderer available, max refresh rate
and a generation hint (`MEDIA_PERFORMANCE_CLASS` on Android, core count on iOS). There's no
device model table. `isLowRamDevice()` costs 30 points and forces `acrylic`.

**Caps.** Thermal `fair` caps at `high`, `serious` at `medium`, `critical` at `low`. Low Power
Mode caps at `medium`. A memory warning caps at `low` for 30 seconds.

**Frame feedback.** Native code sums frames into windows of about 500 ms and sends one summary
per window, never per-frame data. A window counts as stressed when frames average over 1.25×
the target or more than 10% drop. Two stressed windows in a row drop a tier. Climbing back takes
4 s of calm, one tier at a time, and an upgrade that fails within 10 s doubles the next wait (up
to 60 s). It never pushes below `low` and ignores frames while no glass is visible. The target
comes from the display itself, so 60, 90 and 120 Hz all just work.

**Budget.** Native code measures each surface's visible area. Cost grows with area, renderer and
tier, plus a small per-surface overhead, so twenty small buttons cost less than one fullscreen
sheet. Surfaces with the same priority always get the same tier, so cards in a list never mix
glass and acrylic: if twelve cards can't all be live, none of them are. While anything scrolls,
allocations are frozen and the re-rank waits until motion stops. Offscreen surfaces cost
nothing.

**Tweaks.** Fast scrolling turns off refraction and the moving highlight but keeps the blur.
Reduce Motion pins the highlight and turns off the spring motion. Reduce Transparency switches
everything to an opaque material.

| Tier | Renderer | Refraction | Moving highlight | Blur | Live surfaces |
| --- | --- | --- | --- | --- | --- |
| `ultra` | best available | full | yes | 28 dp | 12 |
| `high` | best available | half | yes | 25 dp | 10 |
| `medium` | system or native blur | off | no | 21 dp | 6 |
| `low` | acrylic | off | no | none | 0 |
| `minimal` | flat acrylic | off | no | none | 0 |

Refraction goes first, then the moving highlight, then blur strength, and acrylic comes last.
Tier changes cross-fade in about 300 ms. All the numbers live in `POLICY` in
`src/quality/policy.ts` and none of them come from benchmarks yet.

## Lists

`FlatList`, `FlashList`, `ScrollView` and grids need nothing special. Give navigation
`priority="critical"` and leave cards on `normal`, so the bar keeps its glass while the cards
step down. On Android put the list and the bars over one `GlassBackdrop`, not one per row.
Cards blur the backdrop, not the list content next to them.

## Accessibility

- Reduce Transparency (iOS) turns every surface into a near-opaque fill with a stronger edge.
  Android has no equivalent setting to read.
- Reduce Motion (iOS, or Android's "Remove animations") pins the highlight and stops the spring
  motion and the lens.
- Tints follow light and dark mode, and highlights are mixed from the tint rather than plain
  white.

## Lifecycle and cost

- The iOS display link and the Android frame listener only run while JS is listening, the app is
  in the foreground and some glass is on screen. Idle UI costs nothing on Android.
- Backgrounding stops monitoring. Coming back re-reads thermal, power and accessibility state.
- Android surfaces drop their blur node when detached. Blur effects are shared through a small
  cache keyed by radius, and each AGSL shader compiles once and only rebuilds its effect when a
  uniform changes.
- The spring loops stop as soon as they settle.

## Example app

`example/` is an Expo SDK 57 app that links the library from the repo root.

```bash
npm install
npm run example:ios       # or example:android
```

| Tab | Shows |
| --- | --- |
| Basics | Card, button, lens tab bar, tints, interactive surface |
| Merge | Joining and splitting, a draggable circle, a + button that detaches into three actions |
| Many | 1 to 30 surfaces with live diagnostics |
| Scroll | 200-row `FlatList` of glass cards |
| Stress | Animated backdrop, image grid, interactive tiles, effect toggles |
| Quality | Pins each tier and shows the renderer and capabilities |
| Inspect | Device facts and runtime state |
| A11y | Reduce Transparency and Reduce Motion state |
| Bench | Timed benchmark runs |

## Benchmarks

No numbers yet. They'll only ever come from real devices.

The Bench tab runs for 10 seconds over the animated backdrop with 1 to 30 surfaces, pinned to
`ultra`, `medium`, `low` or left on `auto`, and logs one JSON line per run prefixed with
`[benchmark]`. Use release builds (`npm run ios:release` / `npm run android:release` in
`example/`), a charged phone at a normal temperature, and three runs per setup.

| Device | OS | Surfaces | Mode | Renderer | Avg fps | Avg frame (ms) | Dropped | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| High-end iPhone | | | | | | | | |
| Older iPhone | | | | | | | | |
| High-end Android | | | | | | | | |
| Mid-range Android | | | | | | | | |
| Low-end Android | | | | | | | | |

Frame time isn't the same measure on both platforms. iOS reports the gap between display link
callbacks, Android reports `FrameMetrics.TOTAL_DURATION`, which sits well under budget when
things are smooth. Emulator and simulator numbers mean nothing.

## Troubleshooting

**Flat surfaces and a "native module not found" warning.** You're in Expo Go, or the app wasn't
rebuilt after installing. Run `npx expo run:ios` or `run:android`.

**Acrylic on Android where you expected blur.** The surface needs a `GlassBackdrop` behind it,
as a sibling. `useGlassPerformance().renderer` shows what was actually drawn.

**Blur instead of system glass on iOS 26.** The app sets `UIDesignRequiresCompatibility`, or it
was built with an Xcode older than 26.

**Everything dropped to `low`.** Check `downgradeReason`. `thermal`, `lowPower` and `lowMemory`
come from the OS. `framePerformance` means frames dropped while glass was visible, whatever
caused it. Pin `quality="high"` on the provider to rule the adaptation out.

**A list blanks for one frame while scrolling on iOS.** Look for text next to the list that
updates while it scrolls, like a counter or the diagnostics panel. If its height changes by a
fraction of a point, the list moves mid-scroll and Fabric can draw an empty frame. It happens
without glass too. Give live text a fixed `lineHeight`.

**A background color on `GlassSurface` covers the glass.** On Android the surface is the native
view, so its own background paints over the glass. Put colors on the children or use `tint`.

## Limitations

- Android live blur needs a `GlassBackdrop`, and only what's inside it gets blurred.
- Android has no Reduce Transparency setting.
- iOS below 26 can't read the pixels behind a view, so surfaces there get rim, light and motion
  but no edge bending. The tab bar lens is the exception, it bends its own texture.
- Android press and drag motion need API 29. Older devices keep the highlight only.
- `draggable` always springs back. A surface left where it was dropped would stop receiving
  touches, since React Native doesn't know it moved. Move surfaces with Reanimated if they need
  to stay put.
- iOS frame timing only sees GPU trouble once it delays the app.
- iOS blur strength can't be set directly, tiers switch between two system materials.
- No native drop shadow, it would show through the glass. Use React Native shadow styles.
- Only the New Architecture has been run.
- The scoring weights and budget are guesses until the benchmark table has numbers.

## Architecture

```text
src/
  quality/
    policy.ts                 every constant, scoring, renderer mapping, cost, allocation
    QualityController.ts      frame-driven tier with hysteresis and upgrade backoff
    GlassQualityManager.ts    surface registry, caps, reasons, snapshots for the hooks
  GlassProvider.tsx
  GlassSurface.tsx
  GlassBackdrop.tsx
  GlassTabBar.tsx
  GlassGroup.tsx
  hooks/
ios/
  ExpoAdaptiveGlassView.swift   surface: glass, RN children, press and drag
  GlassLensView.swift           tab bar lens and its springs
  GlassGroupView.swift          merging
  renderers/                    system glass, blur, acrylic layers, Metal lens
  performance/                  display link monitor, capability detector
android/src/main/java/expo/modules/adaptiveglass/
  ExpoAdaptiveGlassView.kt      surface: draws glass before its RN children
  GlassPressMotion.kt           press and drag springs
  GlassBackdropView.kt          shared backdrop RenderNode
  GlassLensView.kt              tab bar lens
  GlassGroupView.kt             merging
  renderers/                    AGSL lens, AGSL merge, blur, acrylic
  performance/                  FrameMetrics monitor, capability detector
```

The native view hosts its React Native children on both platforms. On Android that keeps them
out of the backdrop recording, so the glass never blurs its own text. On iOS it lets the press
and drag move glass and content together.

## Scripts

| Command | Does |
| --- | --- |
| `npm run build` | `tsc` into `build/`, watches in a terminal |
| `npm run prepare` | One clean build |
| `npm test` | Jest: scoring, renderer choice, cost, allocation, hysteresis, manager scenarios |
| `npm run lint` | ESLint over `src/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run example:ios` / `example:android` | Install and run the example |
| `npm run open:ios` / `open:android` | Open the example's native project |

## Notes

Not affiliated with Apple or Google. On iOS 26 it uses Apple's public glass APIs, and no
private API is used on either platform.

MIT licensed.

---

Created by [@rbayuokt](https://github.com/rbayuokt), made with ❤️ and 🎵
