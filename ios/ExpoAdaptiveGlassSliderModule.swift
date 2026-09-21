import ExpoModulesCore

public class ExpoAdaptiveGlassSliderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlassSlider")

    View(GlassSliderView.self) {
      Events("onValueChange", "onSlidingComplete")

      Prop("value") { (view, value: Double) in view.value = CGFloat(value) }
      Prop("disabled") { (view, value: Bool) in view.disabled = value }
      Prop("fillColor") { (view, value: UIColor?) in view.fillColor = value }
      Prop("lens") { (view, value: Bool) in view.lens = value }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
