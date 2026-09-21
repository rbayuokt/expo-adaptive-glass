package expo.modules.adaptiveglass.performance

import android.app.ActivityManager
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display

object GlassCapabilityDetector {
  fun info(context: Context): Map<String, Any> {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
    val metrics = context.resources.displayMetrics
    val sdk = Build.VERSION.SDK_INT
    return mapOf(
      "platform" to "android",
      "osVersion" to Build.VERSION.RELEASE,
      "apiLevel" to sdk,
      "totalMemoryMB" to (mem.totalMem / 1_048_576L).toInt(),
      "lowRamDevice" to am.isLowRamDevice,
      "cpuCores" to Runtime.getRuntime().availableProcessors(),
      "performanceClass" to if (sdk >= Build.VERSION_CODES.S) Build.VERSION.MEDIA_PERFORMANCE_CLASS else 0,
      "screenWidth" to metrics.widthPixels / metrics.density.toDouble(),
      "screenHeight" to metrics.heightPixels / metrics.density.toDouble(),
      "screenScale" to metrics.density.toDouble(),
      "maxRefreshRate" to maxRefreshRate(context),
      "supportsSystemGlass" to false,
      // RenderEffect blur of a RenderNode needs API 31, RuntimeShader needs API 33
      "supportsLiveBlur" to (sdk >= Build.VERSION_CODES.S),
      "supportsShader" to (sdk >= Build.VERSION_CODES.TIRAMISU),
    )
  }

  fun defaultDisplay(context: Context): Display? {
    val dm = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
    return dm?.getDisplay(Display.DEFAULT_DISPLAY)
  }

  private fun maxRefreshRate(context: Context): Double {
    val display = defaultDisplay(context) ?: return 60.0
    val current = display.mode
    // a 120 Hz mode at another resolution isn't reachable, so only count the current one
    return display.supportedModes
      .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
      .maxOfOrNull { it.refreshRate.toDouble() }
      ?.let { Math.round(it).toDouble() }
      ?: display.refreshRate.toDouble()
  }
}
