package expo.modules.adaptiveglass

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Outline
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
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
import kotlin.math.abs
import kotlin.math.hypot

// Hosts its RN children so they stay out of the backdrop recording, otherwise the glass would
// blur its own content.
class ExpoAdaptiveGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onInteractionStart by EventDispatcher<Map<String, Any>>()
  val onInteractionEnd by EventDispatcher<Map<String, Any>>()
  val onDragStart by EventDispatcher<Map<String, Any>>()
  val onDragEnd by EventDispatcher<Map<String, Any>>()
  val onMorphEnd by EventDispatcher<Map<String, Any>>()
  val onMenuSelect by EventDispatcher<Map<String, Any>>()
  val onMenuDismiss by EventDispatcher<Map<String, Any>>()

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
  var clarity = 0f
  var tint: Int? = null
  var tintScheme = "system"
  var cornerRadiusDp = 24f
  var interactive = false
  var draggable = false
  // GlassMenu: the glass shows only this rect (x, y, width, height, radius in dp) and springs to
  // it when it changes. Child `morphIndex` is shown, the others fade out.
  var morphRect: Map<String, Double>? = null
  var morphIndex = 0
  var shadow = 0f
  var edgeColor: Int? = null
  var edgeWidth = 0f
  var edgeRefraction = 0f
  // GlassMenu rows of the shown panel, [x, y, width, height] in dp. While set, the view takes every
  // touch, slides a highlight under the finger and reports the row it's released on.
  var menuRows: List<List<Double>> = emptyList()
  // GlassMenu button: a long press opens the menu and the same finger keeps driving it
  var menuTrigger = false
  val onMenuLongPress by EventDispatcher<Map<String, Any>>()
  private var triggerDownX = 0f
  private var triggerDownY = 0f
  private var triggerFired = false
  private val triggerLongPress = Runnable {
    triggerFired = true
    MenuFinger.press(triggerDownX, triggerDownY, touchSlop.toFloat())
    parent?.requestDisallowInterceptTouchEvent(true)
    performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
    onMenuLongPress(emptyMap())
  }
  private var appliedRows: List<List<Double>> = emptyList()
  private var appliedRowsIndex = -1
  private var hotRow = -1
  // x, y (px): how far the finger pulls the open panel, applied as a jelly stretch
  private val pullSpring = SpringSet(this, 2) { morphFrame() }
  private var pullShiftX = 0f
  private var pullShiftY = 0f
  private var menuPointX = Float.NaN
  private var menuPointY = 0f
  // x, y, width, height (px), alpha
  private val highlightSpring = SpringSet(this, 5) { invalidate() }
  private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var morphActive = false
  private val morphFrom = MorphState()
  private val morphTo = MorphState()
  private val morphNow = MorphState()
  private var morphAppliedIndex = -1
  // button <-> panel morphs go through a round blob, panel <-> panel ones don't
  private var morphBlob = false
  private var morphEndSent = true
  private val morphSpring = SpringSet(this, 1) { morphFrame() }
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
        if (morphActive) {
          val r = morphNow.rect
          outline.setRoundRect(r.left.toInt(), r.top.toInt(), r.right.toInt(), r.bottom.toInt(), morphNow.radius)
        } else {
          outline.setRoundRect(0, 0, view.width, view.height, radiusPx(view.width, view.height))
        }
      }
    }
    clipToOutline = true
    // the outline clips already, LinearLayout's default would also cut children off at their own bounds
    clipChildren = false
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

  // a panel mounted mid-morph stays hidden until the morph picks it
  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (morphActive) child.alpha = if (indexOfChild(child) == morphAppliedIndex) 1f else 0f
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
    updateMorph()
    updateMenu()
    invalidateOutline()
    // no cross-fade right after mount, e.g. the first budget pass
    applyProps(animated = SystemClock.uptimeMillis() - attachedAt > 300)
  }

  private fun applyProps(animated: Boolean) {
    // the outline clip would cut our own shadow off
    clipToOutline = shadow <= 0f
    val dark = isNight(tintScheme)
    material.configure(AcrylicRenderer.Style(
      dark, tint, intensity, opaque, quality == "minimal", clarity, quality == "ultra", edgeColor, edgeWidth,
    ))

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

  private class MorphState {
    val rect = android.graphics.RectF()
    var radius = 0f
    var alphas = FloatArray(0)

    fun set(o: MorphState) {
      rect.set(o.rect)
      radius = o.radius
      alphas = o.alphas.copyOf()
    }
  }

  private fun lerpMorph(t: Float) {
    val a = morphFrom.rect
    val b = morphTo.rect
    morphNow.rect.set(
      a.left + (b.left - a.left) * t, a.top + (b.top - a.top) * t,
      a.right + (b.right - a.right) * t, a.bottom + (b.bottom - a.bottom) * t,
    )
    val pill = minOf(morphNow.rect.width(), morphNow.rect.height()) / 2f
    val tc = t.coerceIn(0f, 1f)
    var radius = morphFrom.radius + (morphTo.radius - morphFrom.radius) * tc
    // roundness eases in from whichever shape we start at, so the corners never jump
    if (morphBlob) {
      val round = if (morphAppliedIndex == 0) 2f * tc - tc * tc else 1f - tc * tc
      radius = maxOf(radius, pill * round)
    }
    morphNow.radius = minOf(radius, pill)
    // outgoing content fades early, incoming overlaps it only briefly
    morphNow.alphas = FloatArray(morphTo.alphas.size) { i ->
      val from = morphFrom.alphas.getOrElse(i) { 0f }
      val to = morphTo.alphas[i]
      val k = if (to > from) ((t - 0.1f) / 0.5f).coerceIn(0f, 1f) else (t / 0.4f).coerceIn(0f, 1f)
      from + (to - from) * k
    }
  }

  private fun updateMorph() {
    val m = morphRect
    if (m == null) {
      if (morphActive) {
        morphActive = false
        morphSpring.stop()
        pullSpring.stop()
        pullSpring.snap(0, 0f)
        pullSpring.snap(1, 0f)
        highlightSpring.stop()
        highlightSpring.snap(4, 0f)
        hotRow = -1
        menuPointX = Float.NaN
        if (MenuFinger.menu?.get() === this) MenuFinger.menu = null
        for (i in 0 until childCount) {
          getChildAt(i).apply {
            alpha = 1f
            scaleX = 1f
            scaleY = 1f
            translationX = 0f
            translationY = 0f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRenderEffect(null)
          }
        }
        invalidate()
      }
      return
    }
    val d = density
    val x = (m["x"] ?: 0.0).toFloat() * d
    val y = (m["y"] ?: 0.0).toFloat() * d
    val target = android.graphics.RectF(x, y, x + (m["width"] ?: 0.0).toFloat() * d, y + (m["height"] ?: 0.0).toFloat() * d)
    val radius = (m["radius"] ?: 0.0).toFloat() * d
    val alphas = FloatArray(childCount) { if (it == morphIndex) 1f else 0f }
    if (!morphActive) {
      morphActive = true
      morphTo.rect.set(target)
      morphTo.radius = radius
      morphTo.alphas = alphas
      morphFrom.set(morphTo)
      morphAppliedIndex = morphIndex
      morphSpring.snap(0, 1f)
      morphFrame()
      return
    }
    if (target == morphTo.rect && radius == morphTo.radius && morphIndex == morphAppliedIndex) return
    lerpMorph(morphSpring.value[0])
    morphFrom.set(morphNow)
    morphTo.rect.set(target)
    morphTo.radius = radius
    morphTo.alphas = alphas
    morphBlob = morphIndex == 0 || morphAppliedIndex == 0
    morphAppliedIndex = morphIndex
    morphEndSent = false
    // reduce motion: the shape jumps, only the content cross-fades
    if (reduceMotion) {
      morphFrom.rect.set(target)
      morphFrom.radius = radius
    }
    morphSpring.snap(0, 0f)
    morphSpring.target[0] = 1f
    // open overshoots a little, close is critically damped so it can't wobble into the button
    val opening = morphBlob && morphIndex != 0
    morphSpring.stiffness = if (opening) 1100f else if (morphBlob) 420f else 300f
    morphSpring.damping = if (opening) 0.62f else 1f
    morphSpring.start()
  }

  private fun morphFrame() {
    if (!morphActive) return
    lerpMorph(morphSpring.value[0])
    applyPull()
    val r = morphNow.rect
    for (i in 0 until minOf(childCount, morphNow.alphas.size)) {
      val child = getChildAt(i)
      val a = morphNow.alphas[i]
      child.alpha = a
      if (a <= 0f || child.width == 0 || child.height == 0) continue
      // content scales with the shape, centre to centre
      val k = minOf(r.width() / child.width, r.height() / child.height)
      child.pivotX = child.width / 2f
      child.pivotY = child.height / 2f
      child.scaleX = k
      child.scaleY = k
      child.translationX = r.centerX() - (child.left + child.width / 2f)
      child.translationY = r.centerY() - (child.top + child.height / 2f)
      // content blurs as it fades, like the system menus
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val b = (1f - a) * 10f * density
        child.setRenderEffect(if (b > 0.5f) android.graphics.RenderEffect.createBlurEffect(b, b, android.graphics.Shader.TileMode.DECAL) else null)
      }
    }
    invalidateOutline()
    invalidate()
    if (morphSpring.value[0] == morphSpring.target[0] && !morphEndSent) {
      morphEndSent = true
      onMorphEnd(mapOf("index" to morphAppliedIndex))
    }
  }

  private val menuActive get() = morphActive && menuRows.isNotEmpty()

  private fun updateMenu() {
    if (menuActive) MenuFinger.menu = java.lang.ref.WeakReference(this)
    // a submenu can have the same row rects as its parent, so the panel index counts too
    if (menuRows != appliedRows || morphIndex != appliedRowsIndex) {
      appliedRows = menuRows
      appliedRowsIndex = morphIndex
      hotRow = -1
      // a long press on the button is still down, its finger drives this menu
      if (menuPointX.isNaN() && MenuFinger.down && MenuFinger.moved) {
        getLocationOnScreen(scratch)
        menuPointX = MenuFinger.x - scratch[0]
        menuPointY = MenuFinger.y - scratch[1]
      }
      // a submenu took over under a finger that's still down, pick up from where it is
      if (!menuPointX.isNaN()) {
        track(menuPointX, menuPointY)
      } else {
        highlightSpring.target[4] = 0f
        highlightSpring.start()
      }
    }
  }

  // forwards a long press on the button, in screen pixels, to the open menu
  private fun handleTrigger(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        triggerFired = false
        triggerDownX = ev.rawX
        triggerDownY = ev.rawY
        removeCallbacks(triggerLongPress)
        postDelayed(triggerLongPress, 300)
      }
      MotionEvent.ACTION_MOVE -> {
        if (triggerFired) {
          MenuFinger.move(ev.rawX, ev.rawY)
        } else if (hypot(ev.rawX - triggerDownX, ev.rawY - triggerDownY) > touchSlop) {
          removeCallbacks(triggerLongPress)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        removeCallbacks(triggerLongPress)
        if (triggerFired) MenuFinger.up(ev.rawX, ev.rawY, ev.actionMasked == MotionEvent.ACTION_UP)
        triggerFired = false
      }
    }
    return true
  }

  fun trackScreen(x: Float, y: Float) {
    getLocationOnScreen(scratch)
    track(x - scratch[0], y - scratch[1])
  }

  fun releaseScreen(x: Float, y: Float) {
    getLocationOnScreen(scratch)
    release(x - scratch[0], y - scratch[1], direct = false)
  }

  // SUSAH BGT ANJG, jari long press dioper lewat global biar menu yang baru muncul kebagian. jelek tapi jalan, TODO later
  // the finger of a button long press, shared with whichever menu is open
  object MenuFinger {
    var menu: java.lang.ref.WeakReference<ExpoAdaptiveGlassView>? = null
    var down = false
    // like iOS, letting go without moving leaves the menu open instead of picking the row underneath
    var moved = false
    var x = 0f
    var y = 0f
    private var startX = 0f
    private var startY = 0f
    private var slop = 0f

    fun press(rx: Float, ry: Float, touchSlop: Float) {
      down = true
      moved = false
      startX = rx
      startY = ry
      x = rx
      y = ry
      slop = touchSlop
    }

    fun move(rx: Float, ry: Float) {
      x = rx
      y = ry
      if (!moved && hypot(rx - startX, ry - startY) > slop) moved = true
      if (moved) menu?.get()?.takeIf { it.menuActive }?.trackScreen(rx, ry)
    }

    fun up(rx: Float, ry: Float, lifted: Boolean) {
      down = false
      val m = menu?.get()?.takeIf { it.menuActive } ?: return
      if (lifted && moved) m.releaseScreen(rx, ry) else m.track(-1f, -1f)
    }
  }

  private fun rowAt(x: Float, y: Float): Int {
    val slack = 8f * density
    menuRows.forEachIndexed { i, r ->
      if (r.size < 4) return@forEachIndexed
      val left = r[0].toFloat() * density - slack
      val top = r[1].toFloat() * density
      if (x >= left && x <= left + r[2].toFloat() * density + 2 * slack && y >= top && y <= top + r[3].toFloat() * density) {
        return i
      }
    }
    return -1
  }

  private fun track(x: Float, y: Float) {
    menuPointX = x
    menuPointY = y
    if (!menuActive) return
    // (-1, -1) is how a cancelled press clears the highlight
    if (x >= 0f || y >= 0f) pullToward(x, y) else letGo()
    val i = rowAt(x, y)
    if (i == hotRow) return
    val wasHidden = hotRow < 0 && highlightSpring.value[4] < 0.05f
    hotRow = i
    if (i < 0) {
      highlightSpring.target[4] = 0f
      highlightSpring.start()
      return
    }
    val r = menuRows[i]
    for (k in 0 until 4) {
      val t = r[k].toFloat() * density
      if (wasHidden) highlightSpring.snap(k, t) else highlightSpring.target[k] = t
    }
    highlightSpring.target[4] = 1f
    highlightSpring.stiffness = 520f
    highlightSpring.damping = 1f
    highlightSpring.start()
    performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
  }

  private fun release(x: Float, y: Float, direct: Boolean) {
    menuPointX = Float.NaN
    if (!menuActive) return
    letGo()
    val i = rowAt(x, y)
    if (i >= 0) {
      onMenuSelect(mapOf("index" to i))
      return
    }
    if (direct && !morphTo.rect.contains(x, y)) onMenuDismiss(emptyMap())
    hotRow = -1
    highlightSpring.target[4] = 0f
    highlightSpring.start()
  }

  private fun handleMenuTouch(ev: MotionEvent) {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> track(ev.x, ev.y)
      MotionEvent.ACTION_UP -> release(ev.x, ev.y, direct = true)
      MotionEvent.ACTION_CANCEL -> {
        letGo()
        menuPointX = Float.NaN
        hotRow = -1
        highlightSpring.target[4] = 0f
        highlightSpring.start()
      }
    }
  }

  // a slight lean toward the finger inside the panel, a rubber band past its edges
  private fun pullToward(x: Float, y: Float) {
    val r = morphTo.rect
    if (r.width() <= 0f) return
    val limit = 36f * density
    fun rubber(o: Float) = if (o == 0f) 0f else Math.signum(o) * limit * (1f - 1f / (1f + abs(o) / limit))
    val ox = x - x.coerceIn(r.left, r.right)
    val oy = y - y.coerceIn(r.top, r.bottom)
    pullSpring.target[0] = rubber(ox) + (x - r.centerX()) * 0.02f
    pullSpring.target[1] = rubber(oy) + (y - r.centerY()) * 0.02f
    pullSpring.stiffness = 700f
    pullSpring.damping = 0.85f
    pullSpring.start()
  }

  private fun letGo() {
    pullSpring.target[0] = 0f
    pullSpring.target[1] = 0f
    pullSpring.stiffness = 500f
    pullSpring.damping = 0.55f
    pullSpring.start()
  }

  // efek jelly, angkanya ngasal sampe enak diliat. jangan tanya kenapa 0.25
  // leading edge follows the pull, trailing edge lags, the other axis thins a little
  private fun applyPull() {
    val dx = pullSpring.value[0]
    val dy = pullSpring.value[1]
    val r = morphNow.rect
    val cx = r.centerX()
    val cy = r.centerY()
    if (abs(dx) > 0.01f || abs(dy) > 0.01f) {
      r.offset(dx * 0.5f, dy * 0.5f)
      r.inset(-abs(dx) * 0.25f + abs(dy) * 0.08f, -abs(dy) * 0.25f + abs(dx) * 0.08f)
      morphNow.radius = minOf(morphNow.radius, minOf(r.width(), r.height()) / 2f)
    }
    pullShiftX = r.centerX() - cx
    pullShiftY = r.centerY() - cy
  }

  private fun drawHighlight(canvas: Canvas) {
    if (!morphActive) return
    val v = highlightSpring.value
    val a = v[4].coerceIn(0f, 1f)
    if (a < 0.01f) return
    val dark = isNight(tintScheme)
    highlightPaint.color = AcrylicRenderer.withAlpha(if (dark) Color.WHITE else Color.BLACK, (if (dark) 0.14f else 0.07f) * a)
    val r = 12f * density
    val x = v[0] + pullShiftX
    val y = v[1] + pullShiftY
    canvas.drawRoundRect(x, y, x + v[2], y + v[3], r, r, highlightPaint)
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

  private val shadowPath = Path()
  private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var shadowNode: Any? = null // RenderNode on API 31+

  private fun shapeInto(path: Path): Float {
    val r = morphNow.rect
    val radius = if (morphActive) morphNow.radius else radiusPx(width, height)
    path.reset()
    if (morphActive) {
      path.addRoundRect(r, radius, radius, Path.Direction.CW)
    } else {
      path.addRoundRect(0f, 0f, width.toFloat(), height.toFloat(), radius, radius, Path.Direction.CW)
    }
    return radius
  }

  // only outside the shape, a shadow behind translucent glass shows through it
  private fun drawShadow(canvas: Canvas) {
    val radius = shapeInto(shadowPath)
    val rect = RectF()
    shadowPath.computeBounds(rect, true)
    val blur = 10f * density
    val dy = 4f * density
    val save = canvas.save()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) canvas.clipOutPath(shadowPath)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && canvas.isHardwareAccelerated) {
      val node = (shadowNode as? RenderNode) ?: RenderNode("GlassShadow").also { shadowNode = it }
      val pad = (blur * 3).toInt()
      node.setPosition(
        rect.left.toInt() - pad, rect.top.toInt() - pad + dy.toInt(),
        rect.right.toInt() + pad, rect.bottom.toInt() + pad + dy.toInt(),
      )
      val rc = node.beginRecording()
      try {
        shadowPaint.color = AcrylicRenderer.withAlpha(Color.BLACK, 0.22f * shadow)
        rc.translate(pad - rect.left, pad - rect.top)
        rc.drawRoundRect(rect, radius, radius, shadowPaint)
      } finally {
        node.endRecording()
      }
      node.setRenderEffect(RenderEffect.createBlurEffect(blur, blur, Shader.TileMode.DECAL))
      canvas.drawRenderNode(node)
    } else {
      // no RenderEffect here, a few fading strokes read close enough
      shadowPaint.style = Paint.Style.STROKE
      for (i in 1..4) {
        shadowPaint.strokeWidth = i * 2f * density
        shadowPaint.color = AcrylicRenderer.withAlpha(Color.BLACK, 0.05f * shadow / i)
        canvas.drawRoundRect(
          rect.left, rect.top + dy, rect.right, rect.bottom + dy, radius, radius, shadowPaint,
        )
      }
      shadowPaint.style = Paint.Style.FILL
    }
    canvas.restoreToCount(save)
  }

  override fun draw(canvas: Canvas) {
    val shadowOn = shadow > 0f && !grouped
    if (shadowOn) drawShadow(canvas)
    val clipSave = if (shadowOn) canvas.save() else -1
    if (shadowOn) {
      shapeInto(shadowPath)
      canvas.clipPath(shadowPath)
    }
    val r = morphNow.rect
    val left = if (morphActive) r.left else 0f
    val top = if (morphActive) r.top else 0f
    val w = if (morphActive) r.width().toInt() else width
    val h = if (morphActive) r.height().toInt() else height
    // in a merging group our own glass would draw twice
    if (w > 0 && h > 0 && !grouped) {
      val radius = if (morphActive) morphNow.radius else radiusPx(w, h)
      val save = canvas.save()
      canvas.translate(left, top)
      val drewBlur = liveMix > 0f && drawBlur(canvas, w, h, radius, left, top)
      if (!drewBlur) activeRenderer = "acrylic"
      val spot = if (activeRenderer == "shaderGlass") 0f else specAlpha
      material.draw(canvas, w, h, radius, if (drewBlur) liveMix else 0f, spot, touchX, touchY)
      canvas.restoreToCount(save)
      drawHighlight(canvas)
    }
    super.draw(canvas)
    if (clipSave >= 0) canvas.restoreToCount(clipSave)
  }

  private fun drawBlur(canvas: Canvas, w: Int, h: Int, radius: Float, left: Float, top: Float): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !canvas.isHardwareAccelerated) return false
    val source = backdrop?.node ?: return false
    // clearer glass blurs less
    // ultra clears further, closer to iOS 26 clear glass
    val clear = if (quality == "ultra") 0.7f else 0.55f
    val blurEffect = NativeBlurRenderer.blur(blur * (1f - clear * clarity) * MAX_BLUR_DP * density)
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
        val bezel = maxOf(minOf(radius, minOf(w, h) * 0.5f), 8f * density)
        shader.effect(
          blurEffect, w.toFloat(), h.toFloat(), radius, bezel,
          // past the shape's own edge band the bend folds back and the outline goes faceted
          minOf(
            refractionNow * MAX_REFRACTION_DP * (1f + 2f * edgeRefraction) * density,
            bezel,
            minOf(w, h) * 0.22f,
          ),
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
    r.draw(canvas, source, offsetX + left, offsetY + top, w, h, radius, liveMix, effect)
    activeRenderer = if (usedShader) "shaderGlass" else "nativeBlur"
    return true
  }


  // watches touches without consuming them, RN touchables keep working
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (morphActive) {
      if (menuActive) {
        handleMenuTouch(ev)
        return true
      }
      // a menu with no rows scrolls its own list, so its rows keep their touches.
      // a closing menu lets them through to the app
      return if (morphIndex > 0) super.dispatchTouchEvent(ev) else false
    }
    if (menuTrigger && handleTrigger(ev)) {
      super.dispatchTouchEvent(ev)
      return true
    }
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
