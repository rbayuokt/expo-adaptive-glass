import ExpoModulesCore

// separate module: older SDKs allow one view per module
public class ExpoAdaptiveGlassLensModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlassLens")

    View(GlassLensView.self) {
      Events("onTabSelect")

      Prop("selectedIndex") { (view, value: Int) in view.selectedIndex = value }
      Prop("lensStyle") { (view, value: String) in view.lensStyle = value }
      Prop("restPill") { (view: GlassLensView, value: Bool) in view.restPill = value }
      Prop("pillColor") { (view: GlassLensView, value: UIColor?) in view.pillColor = value }
      Prop("tintColor") { (view, value: UIColor?) in view.glassTint = value }
      Prop("tintScheme") { (view, value: String) in view.tintScheme = value }
      Prop("refraction") { (view, value: Bool) in view.refraction = value }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
