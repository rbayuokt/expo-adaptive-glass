package expo.modules.adaptiveglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoAdaptiveGlassSwitchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlassSwitch")

    View(GlassSwitchView::class) {
      Events("onValueChange")

      Prop("value") { view: GlassSwitchView, value: Boolean -> view.value = value }
      Prop("disabled") { view: GlassSwitchView, value: Boolean -> view.disabled = value }
      Prop("onColor") { view: GlassSwitchView, value: Int? -> view.onColor = value }
      Prop("lens") { view: GlassSwitchView, value: Boolean -> view.lens = value }
      Prop("scheme") { view: GlassSwitchView, value: String -> view.scheme = value }

      OnViewDidUpdateProps { view: GlassSwitchView ->
        view.propsDidUpdate()
      }
    }
  }
}
