package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoAdaptiveGlassSliderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassSlider")

    View(GlassSliderView::class) {
      Events("onValueChange", "onSlidingComplete")

      Prop("value") { view: GlassSliderView, value: Double -> view.value = value.toFloat() }
      Prop("disabled") { view: GlassSliderView, value: Boolean -> view.disabled = value }
      Prop("fillColor") { view: GlassSliderView, value: Int? -> view.fillColor = value }
      Prop("lens") { view: GlassSliderView, value: Boolean -> view.lens = value }

      OnViewDidUpdateProps { view: GlassSliderView ->
        view.propsDidUpdate()
      }
    }
  }
}
