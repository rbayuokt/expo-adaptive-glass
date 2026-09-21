import ExpoModulesCore

// separate module: older SDKs allow one view per module
public class ExpoAdaptiveGlassGroupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlassGroup")

    View(GlassGroupView.self) {
      Prop("spacing") { (view, value: Double) in view.spacing = CGFloat(value) }
      Prop("intensity") { (view, value: Double) in view.intensity = CGFloat(value) }
      Prop("tintColor") { (view, value: UIColor?) in view.glassTint = value }
      Prop("tintScheme") { (view, value: String) in view.tintScheme = value }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
