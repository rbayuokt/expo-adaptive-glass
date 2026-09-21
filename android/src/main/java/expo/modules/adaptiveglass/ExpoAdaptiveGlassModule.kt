package expo.modules.adaptiveglass

import expo.modules.adaptiveglass.performance.GlassCapabilityDetector
import expo.modules.adaptiveglass.performance.GlassPerformanceMonitor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoAdaptiveGlassModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("ExpoAdaptiveGlass")

    Events("onStats")

    Function("getDeviceInfo") {
      GlassCapabilityDetector.info(context)
    }

    OnStartObserving {
      GlassPerformanceMonitor.start(context, appContext.currentActivity) { sendEvent("onStats", it) }
    }

    OnStopObserving {
      GlassPerformanceMonitor.stop()
    }

    OnActivityEntersForeground {
      GlassPerformanceMonitor.setForeground(true, appContext.currentActivity)
    }

    OnActivityEntersBackground {
      GlassPerformanceMonitor.setForeground(false, null)
    }

    OnDestroy {
      GlassPerformanceMonitor.stop()
    }

    View(ExpoAdaptiveGlassView::class) {
      Events("onInteractionStart", "onInteractionEnd", "onDragStart", "onDragEnd")

      Prop("surfaceId") { view: ExpoAdaptiveGlassView, value: String -> view.surfaceId = value }
      Prop("renderer") { view: ExpoAdaptiveGlassView, value: String -> view.renderer = value }
      Prop("quality") { view: ExpoAdaptiveGlassView, value: String -> view.quality = value }
      Prop("blur") { view: ExpoAdaptiveGlassView, value: Double -> view.blur = value.toFloat() }
      Prop("refraction") { view: ExpoAdaptiveGlassView, value: Double -> view.refraction = value.toFloat() }
      Prop("dynamicHighlights") { view: ExpoAdaptiveGlassView, value: Boolean -> view.dynamicHighlights = value }
      Prop("shaderQuality") { view: ExpoAdaptiveGlassView, value: Int -> view.shaderQuality = value }
      Prop("opaque") { view: ExpoAdaptiveGlassView, value: Boolean -> view.opaque = value }
      Prop("reduceMotion") { view: ExpoAdaptiveGlassView, value: Boolean -> view.reduceMotion = value }
      Prop("intensity") { view: ExpoAdaptiveGlassView, value: Double -> view.intensity = value.toFloat() }
      Prop("tintColor") { view: ExpoAdaptiveGlassView, value: Int? -> view.tint = value }
      Prop("tintScheme") { view: ExpoAdaptiveGlassView, value: String -> view.tintScheme = value }
      Prop("cornerRadius") { view: ExpoAdaptiveGlassView, value: Double -> view.cornerRadiusDp = value.toFloat() }
      Prop("interactive") { view: ExpoAdaptiveGlassView, value: Boolean -> view.interactive = value }
      Prop("draggable") { view: ExpoAdaptiveGlassView, value: Boolean -> view.draggable = value }

      OnViewDidUpdateProps { view: ExpoAdaptiveGlassView ->
        view.propsDidUpdate()
      }
    }
  }
}
