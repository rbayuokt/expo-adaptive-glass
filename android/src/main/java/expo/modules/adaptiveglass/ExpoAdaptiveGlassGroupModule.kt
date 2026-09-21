package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// own module, older Expo SDKs allow one view per module
class ExpoAdaptiveGlassGroupModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassGroup")

    View(GlassGroupView::class) {
      Prop("spacing") { view: GlassGroupView, value: Double -> view.spacingDp = value.toFloat() }
      Prop("intensity") { view: GlassGroupView, value: Double -> view.intensity = value.toFloat() }
      Prop("tintColor") { view: GlassGroupView, value: Int? -> view.tint = value }
      Prop("tintScheme") { view: GlassGroupView, value: String -> view.tintScheme = value }

      OnViewDidUpdateProps { view: GlassGroupView ->
        view.propsDidUpdate()
      }
    }
  }
}
