package expo.modules.adaptiveglass.performance

import android.animation.ValueAnimator
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.FrameMetrics
import android.view.Window
import expo.modules.adaptiveglass.ExpoAdaptiveGlassView
import java.lang.ref.WeakReference

// FrameMetrics over the ~500 ms windows: real render durations (GPU included on 31+) and free
// while idle. Everything but the frame counters is main thread only.
object GlassPerformanceMonitor {
  private const val WINDOW_MS = 500L
  private const val SLOW_DP_PER_S = 60f
  private const val FAST_DP_PER_S = 1200f
  private const val SETTLE_MS = 300L
  private const val LOW_MEMORY_MS = 30_000L

  private val main = Handler(Looper.getMainLooper())
  private var emit: ((Map<String, Any?>) -> Unit)? = null
  private var app: Context? = null
  private var foreground = true
  private val views = ArrayList<WeakReference<ExpoAdaptiveGlassView>>()

  private var window: WeakReference<Window>? = null
  private var frameThread: HandlerThread? = null
  private var running = false

  // written on the frame thread, read on main
  private val lock = Any()
  private var frames = 0
  private var sumNs = 0L
  private var deadlineSumNs = 0L
  private var worstNs = 0L
  private var dropped = 0
  private var windowStart = SystemClock.uptimeMillis()
  @Volatile private var expectedNs = 16_666_667L

  private var scrollState = "idle"
  private var lastFastAt = 0L
  private var lastMovingAt = 0L
  private var lowMemoryUntil = 0L
  private val rect = Rect()

  private val tick = object : Runnable {
    override fun run() {
      emitNow()
      if (running) main.postDelayed(this, WINDOW_MS)
    }
  }

  private val frameListener = Window.OnFrameMetricsAvailableListener { _, m, _ ->
    if (m.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1L) return@OnFrameMetricsAvailableListener
    val total = m.getMetric(FrameMetrics.TOTAL_DURATION)
    val deadline =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) m.getMetric(FrameMetrics.DEADLINE) else expectedNs
    synchronized(lock) {
      frames++
      sumNs += total
      deadlineSumNs += deadline
      if (total > worstNs) worstNs = total
      if (deadline in 1 until total) dropped += ((total - 1) / deadline).toInt()
    }
  }

  private val powerReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) = emitNow()
  }

  private val memoryCallbacks = object : ComponentCallbacks2 {
    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
      if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
        level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE
      ) {
        main.post { markLowMemory() }
      }
    }

    override fun onLowMemory() {
      main.post { markLowMemory() }
    }

    override fun onConfigurationChanged(newConfig: Configuration) = Unit
  }


  fun start(context: Context, activity: Activity?, emit: (Map<String, Any?>) -> Unit) = main.post {
    this.emit = emit
    if (app == null) {
      app = context.applicationContext
      installSystemListeners()
    }
    attachWindow(activity)
    update()
    emitNow()
  }

  fun stop() = main.post {
    emit = null
    update()
  }

  fun setForeground(value: Boolean, activity: Activity?) = main.post {
    foreground = value
    if (value) attachWindow(activity)
    update()
    if (value) emitNow()
  }

  fun register(view: ExpoAdaptiveGlassView) {
    views.removeAll { it.get() == null || it.get() === view }
    views.add(WeakReference(view))
    update()
  }

  fun unregister(view: ExpoAdaptiveGlassView) {
    views.removeAll { it.get() == null || it.get() === view }
    update()
  }

  fun reportMotion(dpPerSecond: Float) {
    val now = SystemClock.uptimeMillis()
    if (dpPerSecond >= FAST_DP_PER_S) lastFastAt = now
    if (dpPerSecond >= SLOW_DP_PER_S) lastMovingAt = now
    evaluateScroll(now)
  }


  private fun attachWindow(activity: Activity?) {
    val w = activity?.window ?: return
    if (window?.get() === w) return
    detachFrames()
    window = WeakReference(w)
    GlassCapabilityDetector.defaultDisplay(activity)?.let { expectedNs = (1_000_000_000L / it.refreshRate).toLong() }
    if (running) attachFrames()
  }

  private fun update() {
    val wanted = emit != null && foreground && views.isNotEmpty()
    if (wanted == running) return
    running = wanted
    if (wanted) {
      resetWindow()
      attachFrames()
      main.postDelayed(tick, WINDOW_MS)
    } else {
      main.removeCallbacks(tick)
      detachFrames()
    }
  }

  private fun attachFrames() {
    val w = window?.get() ?: return
    val thread = frameThread ?: HandlerThread("ExpoAdaptiveGlassFrames").also {
      it.start()
      frameThread = it
    }
    try {
      w.addOnFrameMetricsAvailableListener(frameListener, Handler(thread.looper))
    } catch (_: IllegalStateException) {
      // already attached
    }
  }

  private fun detachFrames() {
    try {
      window?.get()?.removeOnFrameMetricsAvailableListener(frameListener)
    } catch (_: IllegalArgumentException) {
      // was not attached
    }
  }

  private fun resetWindow() {
    synchronized(lock) {
      frames = 0
      sumNs = 0
      deadlineSumNs = 0
      worstNs = 0
      dropped = 0
    }
    windowStart = SystemClock.uptimeMillis()
  }

  // goes up instantly, settles with a delay so a fling doesn't flicker
  private fun scrollStateAt(now: Long) = when {
    now - lastFastAt < SETTLE_MS -> "fast"
    now - lastMovingAt < SETTLE_MS -> "slow"
    else -> "idle"
  }

  private fun evaluateScroll(now: Long) {
    val next = scrollStateAt(now)
    if (next != scrollState) {
      scrollState = next
      emitNow()
    }
  }

  private fun markLowMemory() {
    lowMemoryUntil = SystemClock.uptimeMillis() + LOW_MEMORY_MS
    emitNow()
  }

  private fun emitNow() {
    val emit = emit ?: return
    val ctx = app ?: return
    val now = SystemClock.uptimeMillis()
    scrollState = scrollStateAt(now)

    val f: Int
    val sum: Long
    val deadlines: Long
    val worst: Long
    val drop: Int
    synchronized(lock) {
      f = frames
      sum = sumNs
      deadlines = deadlineSumNs
      worst = worstNs
      drop = dropped
    }
    val target = if (f > 0) deadlines.toDouble() / f else expectedNs.toDouble()
    val density = ctx.resources.displayMetrics.density
    val surfaces = ArrayList<Map<String, Any>>()
    views.removeAll { it.get() == null }
    for (ref in views) {
      val v = ref.get() ?: continue
      if (!v.isAttachedToWindow || !v.isShown || !v.getGlobalVisibleRect(rect)) continue
      surfaces.add(
        mapOf(
          "id" to v.surfaceId,
          "area" to rect.width() * rect.height() / (density * density).toDouble(),
          "renderer" to v.activeRenderer,
        )
      )
    }
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val refresh = GlassCapabilityDetector.defaultDisplay(ctx)?.refreshRate?.toDouble() ?: 60.0

    emit(
      mapOf(
        "windowMs" to (now - windowStart).toDouble(),
        "sampleCount" to f,
        "refreshRate" to Math.round(refresh).toDouble(),
        "targetFrameTimeMs" to target / 1e6,
        "averageFrameTimeMs" to if (f > 0) sum.toDouble() / f / 1e6 else 0.0,
        "worstFrameTimeMs" to worst / 1e6,
        "droppedFrameRatio" to if (f + drop > 0) drop.toDouble() / (f + drop) else 0.0,
        "thermalState" to thermalState(pm),
        "lowPowerMode" to pm.isPowerSaveMode,
        "lowMemory" to (now < lowMemoryUntil),
        // Android has no public Reduce Transparency setting
        "reduceTransparency" to false,
        "reduceMotion" to reduceMotion(ctx),
        "scrollState" to scrollState,
        "surfaces" to surfaces,
      )
    )
    resetWindow()
  }

  private fun thermalState(pm: PowerManager): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "nominal"
    return when (pm.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE -> "nominal"
      PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> "fair"
      PowerManager.THERMAL_STATUS_SEVERE -> "serious"
      else -> "critical"
    }
  }

  fun reduceMotion(ctx: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      !ValueAnimator.areAnimatorsEnabled()
    } else {
      Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }

  private fun installSystemListeners() {
    val ctx = app ?: return
    val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.registerReceiver(powerReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      ctx.registerReceiver(powerReceiver, filter)
    }
    ctx.registerComponentCallbacks(memoryCallbacks)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.addThermalStatusListener(ctx.mainExecutor) { emitNow() }
    }
  }
}
