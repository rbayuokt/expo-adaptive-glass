import ExpoModulesCore

public class ExpoAdaptiveGlassSwitchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlassSwitch")

    View(GlassSwitchView.self) {
      Events("onValueChange")

      Prop("value") { (view, value: Bool) in view.value = value }
      Prop("disabled") { (view, value: Bool) in view.disabled = value }
      Prop("onColor") { (view, value: UIColor?) in view.onColor = value }
      Prop("lens") { (view, value: Bool) in view.lens = value }
      // Android only, iOS follows the window's style
      Prop("scheme") { (_: GlassSwitchView, _: String) in }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
