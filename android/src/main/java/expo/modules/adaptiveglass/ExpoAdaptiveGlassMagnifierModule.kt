package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoAdaptiveGlassMagnifierModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassMagnifier")

    View(GlassMagnifierView::class) {
      Prop("lensWidth") { view: GlassMagnifierView, value: Float -> view.lensWidth = value }
      Prop("lensHeight") { view: GlassMagnifierView, value: Float -> view.lensHeight = value }
      Prop("magnification") { view: GlassMagnifierView, value: Float -> view.magnification = value }
      Prop("lift") { view: GlassMagnifierView, value: Float -> view.lift = value }
      Prop("refraction") { view: GlassMagnifierView, value: Boolean -> view.refraction = value }
      Prop("disabled") { view: GlassMagnifierView, value: Boolean -> view.disabled = value }
    }
  }
}
