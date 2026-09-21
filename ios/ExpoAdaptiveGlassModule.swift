import ExpoModulesCore

public class ExpoAdaptiveGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAdaptiveGlass")

    Events("onStats")

    OnCreate {
      GlassCapabilityDetector.prewarm()
    }

    Function("getDeviceInfo") {
      GlassCapabilityDetector.deviceInfo()
    }

    OnStartObserving {
      DispatchQueue.main.async { [weak self] in
        GlassPerformanceMonitor.shared.startObserving { payload in
          self?.sendEvent("onStats", payload)
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async { GlassPerformanceMonitor.shared.stopObserving() }
    }

    OnDestroy {
      DispatchQueue.main.async { GlassPerformanceMonitor.shared.stopObserving() }
    }

    View(ExpoAdaptiveGlassView.self) {
      Events("onInteractionStart", "onInteractionEnd", "onDragStart", "onDragEnd")

      Prop("surfaceId") { (view, value: String) in view.surfaceId = value }
      Prop("renderer") { (view, value: String) in view.renderer = value }
      Prop("quality") { (view, value: String) in view.quality = value }
      Prop("blur") { (view, value: Double) in view.blur = CGFloat(value) }
      Prop("refraction") { (view, value: Double) in view.refraction = CGFloat(value) }
      Prop("dynamicHighlights") { (view, value: Bool) in view.dynamicHighlights = value }
      Prop("opaque") { (view, value: Bool) in view.opaqueMaterial = value }
      Prop("reduceMotion") { (view, value: Bool) in view.reduceMotion = value }
      Prop("intensity") { (view, value: Double) in view.intensity = CGFloat(value) }
      Prop("tintColor") { (view, value: UIColor?) in view.glassTint = value }
      Prop("tintScheme") { (view, value: String) in view.tintScheme = value }
      Prop("cornerRadius") { (view, value: Double) in view.cornerRadius = CGFloat(value) }
      Prop("interactive") { (view, value: Bool) in view.interactive = value }
      Prop("draggable") { (view, value: Bool) in view.draggable = value }
      // Android only
      Prop("shaderQuality") { (_: ExpoAdaptiveGlassView, _: Int) in }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}
