package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// own module, older Expo SDKs allow one view per module
class ExpoAdaptiveGlassLensModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassLens")

    View(GlassLensView::class) {
      Events("onTabSelect")

      Prop("selectedIndex") { view: GlassLensView, value: Int -> view.selectedIndex = value }
      Prop("lensStyle") { view: GlassLensView, value: String -> view.lensStyle = value }
      Prop("refraction") { view: GlassLensView, value: Boolean -> view.refraction = value }
      Prop("tintColor") { view: GlassLensView, value: Int? -> view.tint = value }
      Prop("tintScheme") { view: GlassLensView, value: String -> view.tintScheme = value }

      OnViewDidUpdateProps { view: GlassLensView ->
        view.propsDidUpdate()
      }
    }
  }
}
