import ExpoModulesCore

public class ExpoAdaptiveGlassMagnifierModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlassMagnifier")

    View(GlassMagnifierView.self) {
      Prop("lensWidth") { (view, value: Double) in view.lensWidth = CGFloat(value) }
      Prop("lensHeight") { (view, value: Double) in view.lensHeight = CGFloat(value) }
      Prop("magnification") { (view, value: Double) in view.magnification = CGFloat(value) }
      Prop("lift") { (view, value: Double) in view.lift = CGFloat(value) }
      Prop("refraction") { (view, value: Bool) in view.refraction = value }
      Prop("disabled") { (view, value: Bool) in view.disabled = value }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
