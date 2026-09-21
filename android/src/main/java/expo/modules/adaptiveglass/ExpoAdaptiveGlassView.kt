package expo.modules.adaptiveglass

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Outline
import android.os.Build
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.ViewTreeObserver
import android.view.animation.DecelerateInterpolator
import expo.modules.adaptiveglass.performance.GlassPerformanceMonitor
import expo.modules.adaptiveglass.renderers.AcrylicRenderer
import expo.modules.adaptiveglass.renderers.NativeBlurRenderer
import expo.modules.adaptiveglass.renderers.ShaderGlassRenderer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.hypot

// Hosts its RN children so they stay out of the backdrop recording, otherwise the glass would
// blur its own content.
class ExpoAdaptiveGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onInteractionStart by EventDispatcher<Map<String, Any>>()
  val onInteractionEnd by EventDispatcher<Map<String, Any>>()
  val onDragStart by EventDispatcher<Map<String, Any>>()
  val onDragEnd by EventDispatcher<Map<String, Any>>()

  var surfaceId = ""
  var renderer = "acrylic"
  var quality = "high"
  var blur = 1f
  var refraction = 0f
  var dynamicHighlights = false
  var shaderQuality = 0
  var opaque = false
  var reduceMotion = false
  var intensity = 0.6f
  var tint: Int? = null
  var tintScheme = "system"
  var cornerRadiusDp = 24f
  var interactive = false
  var draggable = false
  private var dragging = false
  private var dragStartX = 0f
  private var dragStartY = 0f
  private val touchSlop = android.view.ViewConfiguration.get(context).scaledTouchSlop

  // what actually got drawn, reported in stats
  var activeRenderer = "acrylic"
    private set

  private val density = resources.displayMetrics.density
  private val material = AcrylicRenderer(density)
  private var blurRenderer: Any? = null // NativeBlurRenderer on API 31+
  private var shaderRenderer: Any? = null // ShaderGlassRenderer on API 33+

  private var backdrop: GlassBackdropView? = null
  private var backdropVersion = -1
  private val loc = IntArray(2)
  private val scratch = IntArray(2)
  private var offsetX = 0f
  private var offsetY = 0f
  private var lastX = Int.MIN_VALUE
  private var lastY = 0
  private var lastSampleAt = 0L
  private var observer: ViewTreeObserver? = null
  private var attachedAt = 0L
  private var group: GlassGroupView? = null
  // the group draws our glass, we only keep the content
  private var grouped = false

  private var liveMix = 0f
  private var refractionNow = 0f
  private var targetLive = false
  private var mixAnimator: ValueAnimator? = null
  private var specAlpha = 0f
  private var specAnimator: ValueAnimator? = null
  private var touchX = 0f
  private var touchY = 0f
  private var downX = 0f
  private var downY = 0f
  private var pressed = false
  // only the shader reads the press value, the transform alone needs no redraw
  private val motion = GlassPressMotion(this) { if (activeRenderer == "shaderGlass") invalidate() }

  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    onPreDrawTick()
    true
  }

  init {
    setWillNotDraw(false)
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, radiusPx(view.width, view.height))
      }
    }
    clipToOutline = true
  }


  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attachedAt = SystemClock.uptimeMillis()
    lastX = Int.MIN_VALUE
    backdropVersion = -1
    observer = viewTreeObserver.also { it.addOnPreDrawListener(preDraw) }
    GlassPerformanceMonitor.register(this)
    var p = parent
    while (p != null && p !is GlassGroupView) p = p.parent
    group = p as? GlassGroupView
    grouped = group?.register(this) ?: false
    applyProps(animated = false)
  }

  override fun onDetachedFromWindow() {
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(preDraw)
    observer = null
    GlassPerformanceMonitor.unregister(this)
    group?.unregister(this)
    group = null
    grouped = false
    mixAnimator?.cancel()
    specAnimator?.cancel()
    motion.reset()
    pressed = false
    backdrop = null
    // free the GPU memory, the node gets re-recorded on the next draw
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) (blurRenderer as? NativeBlurRenderer)?.release()
    super.onDetachedFromWindow()
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    applyProps(animated = false)
  }

  // RN already measured and placed the children, LinearLayout must not redo it
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
      MeasureSpec.getSize(widthMeasureSpec),
      MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    invalidateOutline()
  }


  fun propsDidUpdate() {
    invalidateOutline()
    // no cross-fade right after mount, e.g. the first budget pass
    applyProps(animated = SystemClock.uptimeMillis() - attachedAt > 300)
  }

  private fun applyProps(animated: Boolean) {
    val dark = when (tintScheme) {
      "dark" -> true
      "light" -> false
      else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }
    material.configure(AcrylicRenderer.Style(dark, tint, intensity, opaque, quality == "minimal"))

    val wantsLive = !opaque && (renderer == "nativeBlur" || renderer == "shaderGlass") &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    animateTo(if (wantsLive) 1f else 0f, if (wantsLive) refraction else 0f, animated)
    targetLive = wantsLive
    invalidate()
  }

  private fun animateTo(mix: Float, refr: Float, animated: Boolean) {
    mixAnimator?.cancel()
    if (!animated || !isAttachedToWindow) {
      liveMix = mix
      refractionNow = refr
      return
    }
    val fromMix = liveMix
    val fromRefr = refractionNow
    mixAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 250
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        val t = it.animatedValue as Float
        liveMix = fromMix + (mix - fromMix) * t
        refractionNow = fromRefr + (refr - fromRefr) * t
        invalidate()
      }
      start()
    }
  }

  // radii past half the short side (999 for a capsule) break the shader's distance field and
  // each quadrant bends a different way
  private fun radiusPx(w: Int, h: Int) = minOf(cornerRadiusDp * density, minOf(w, h) / 2f)


  private fun onPreDrawTick() {
    getLocationInWindow(loc)
    val now = SystemClock.uptimeMillis()
    if (lastX != Int.MIN_VALUE && now > lastSampleAt) {
      val d = hypot((loc[0] - lastX).toFloat(), (loc[1] - lastY).toFloat()) / density
      GlassPerformanceMonitor.reportMotion(d * 1000f / (now - lastSampleAt))
    }
    lastX = loc[0]
    lastY = loc[1]
    lastSampleAt = now

    if (grouped || (!targetLive && liveMix == 0f)) return
    val b = backdrop
    if (b == null || !b.isAttachedToWindow || backdropVersion != GlassBackdropView.Registry.version) {
      backdropVersion = GlassBackdropView.Registry.version
      backdrop = GlassBackdropView.Registry.find(this, loc, scratch)
    }
    val found = backdrop ?: return
    found.getLocationInWindow(scratch)
    offsetX = (loc[0] - scratch[0]).toFloat()
    offsetY = (loc[1] - scratch[1]).toFloat()
    // invalidating in pre-draw joins this frame instead of scheduling another one
    invalidate()
  }

  override fun draw(canvas: Canvas) {
    val w = width
    val h = height
    // in a merging group our own glass would draw twice
    if (w > 0 && h > 0 && !grouped) {
      val radius = radiusPx(w, h)
      val drewBlur = liveMix > 0f && drawBlur(canvas, w, h, radius)
      if (!drewBlur) activeRenderer = "acrylic"
      val spot = if (activeRenderer == "shaderGlass") 0f else specAlpha
      material.draw(canvas, w, h, radius, if (drewBlur) liveMix else 0f, spot, touchX, touchY)
    }
    super.draw(canvas)
  }

  private fun drawBlur(canvas: Canvas, w: Int, h: Int, radius: Float): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !canvas.isHardwareAccelerated) return false
    val source = backdrop?.node ?: return false
    val blurEffect = NativeBlurRenderer.blur(blur * MAX_BLUR_DP * density)
    var effect = blurEffect
    var usedShader = false
    if (renderer == "shaderGlass" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val lightOn = dynamicHighlights && !reduceMotion
      // nothing for the shader to add, skip the pass
      if (refractionNow > 0.001f || lightOn || shaderQuality >= 2) {
        val shader = (shaderRenderer as? ShaderGlassRenderer) ?: ShaderGlassRenderer().also { shaderRenderer = it }
        // light rests above the top-left corner and slides to the finger while touched
        val k = if (lightOn) specAlpha else 0f
        val lightX = -0.25f * w + (touchX + 0.25f * w) * k
        val lightY = -0.6f * h + (touchY + 0.6f * h) * k
        shader.effect(
          blurEffect, w.toFloat(), h.toFloat(), radius,
          maxOf(minOf(radius, minOf(w, h) * 0.5f), 8f * density),
          refractionNow * MAX_REFRACTION_DP * density,
          if (shaderQuality >= 3) 1f else 0f,
          lightX, lightY, k,
          if (shaderQuality >= 2) 1f else 0.6f,
          if (reduceMotion) 0f else motion.press,
        )?.let {
          effect = it
          usedShader = true
        }
      }
    }
    val r = (blurRenderer as? NativeBlurRenderer) ?: NativeBlurRenderer().also { blurRenderer = it }
    r.draw(canvas, source, offsetX, offsetY, w, h, radius, liveMix, effect)
    activeRenderer = if (usedShader) "shaderGlass" else "nativeBlur"
    return true
  }


  // watches touches without consuming them, RN touchables keep working
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (draggable) handleDrag(ev)
    if (interactive) {
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          pressed = true
          downX = ev.x
          downY = ev.y
          touchX = if (reduceMotion) width / 2f else ev.x
          touchY = if (reduceMotion) 0f else ev.y
          fadeSpecular(1f, 120)
          if (!reduceMotion) motion.pressTo(0f, 0f)
          onInteractionStart(emptyMap())
        }
        // a parent that starts scrolling sends ACTION_CANCEL
        MotionEvent.ACTION_MOVE -> if (pressed && !reduceMotion) {
          // a dragged surface already follows the finger, no lean on top
          if (!dragging) motion.pressTo(ev.x - downX, ev.y - downY)
          if (dynamicHighlights) {
            touchX = ev.x
            touchY = ev.y
            invalidate()
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> endPress()
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  // RN handles touches at the root, so nothing claims ACTION_DOWN and Android would send us no
  // moves or release. The root still sees every event and a scrolling parent can still steal it
  override fun onTouchEvent(event: MotionEvent): Boolean = interactive || draggable || super.onTouchEvent(event)

  // raw coordinates, the view itself moves under the finger
  private fun handleDrag(ev: MotionEvent) {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragStartX = ev.rawX
        dragStartY = ev.rawY
        // a scrolling parent must not steal the drag
        parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = ev.rawX - dragStartX
        val dy = ev.rawY - dragStartY
        if (!dragging && hypot(dx, dy) > touchSlop) {
          dragging = true
          onDragStart(emptyMap())
        }
        if (dragging) motion.dragTo(dx, dy)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (dragging) {
        dragging = false
        motion.release()
        onDragEnd(mapOf("x" to (ev.rawX - dragStartX) / density, "y" to (ev.rawY - dragStartY) / density))
      }
    }
  }

  // the group draws our glass, so it needs the press transform
  fun pressTransform(out: FloatArray) = motion.current(out)

  private fun endPress() {
    if (!pressed) return
    pressed = false
    fadeSpecular(0f, 250)
    motion.release()
    onInteractionEnd(emptyMap())
  }

  private fun fadeSpecular(to: Float, ms: Long) {
    specAnimator?.cancel()
    specAnimator = ValueAnimator.ofFloat(specAlpha, to).apply {
      duration = ms
      addUpdateListener {
        specAlpha = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  companion object {
    private const val MAX_BLUR_DP = 28f
    private const val MAX_REFRACTION_DP = 14f
  }
}
