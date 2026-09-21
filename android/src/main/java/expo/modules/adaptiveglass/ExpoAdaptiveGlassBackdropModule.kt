package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// own module, older Expo SDKs allow one view per module
class ExpoAdaptiveGlassBackdropModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassBackdrop")

    View(GlassBackdropView::class) {}
  }
}
